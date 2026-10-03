import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import { sendToDevice } from './FCMDispatcher';
import { KGManager } from './KGManager';
import { WikiSynthesisService } from './WikiSynthesisService';
import crypto from 'crypto';

export interface SyncPayload {
  deviceId: string;
  timestamp: number;
  meetings?: any[];
  meetingSegments?: any[];
  calendarEvents?: any[];
  chats?: any[];
  memories?: any[];
  /** Deletions made on the device (push) or on other devices (pull) */
  deletions?: SyncDeletion[];
}

/** A deleted meeting (its segments go with it) or a single deleted segment */
export interface SyncDeletion {
  type: 'meeting' | 'segment';
  id: string;
  deletedAt: number;
}

const DELETION_TYPES = new Set(['meeting', 'segment']);

export interface PullResult extends SyncPayload {
  /** Titles of the conversations the pulled chat messages belong to */
  conversations: { id: string; title: string; created_at: number; last_message_at: number | null }[];
}

const toMs = (value: unknown, fallback: number): number => {
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : fallback;
};

/**
 * Message ids are only unique inside a device thread (they are often Date.now()):
 * on the server they are namespaced by conversation. Already namespaced ids (messages
 * pulled from the server and pushed back by another device) are kept as they are.
 */
export const chatMessageId = (conversationId: string, messageId: string) =>
  messageId.startsWith(`${conversationId}:`) ? messageId : `${conversationId}:${messageId}`;

export class SyncManager {
  /**
   * Process incoming data from a mobile device.
   * Every SQLite write happens in one transaction (all or nothing); memories then go
   * to Neo4j one by one and the ids that failed are returned, so the device retries them.
   */
  public static async handlePush(payload: SyncPayload): Promise<{ failedMemoryIds: string[] }> {
    const { deviceId, timestamp } = payload;
    const logId = crypto.randomUUID();
    const now = Date.now();

    try {
      Logger.info('SyncManager', `Received push from ${deviceId} (ts: ${timestamp})`);
      db.transaction(() => this.writePush(payload, now))();
    } catch (err: any) {
      Logger.error('SyncManager', `Critical push failure from ${deviceId}: ${err.message}`);
      db.prepare(`
        INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, error_msg, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(logId, deviceId, 'UPLOAD', 'MIXED', 0, 'FAILED', err.message, Date.now());
      throw err;
    }

    // Memories (Knowledge Ingestion): merged on device + local id, so a retry never duplicates
    const failedMemoryIds: string[] = [];
    for (const mem of payload.memories ?? []) {
      try {
        const embedding = Array.isArray(mem.embedding) ? mem.embedding : [];
        await KGManager.upsertMemory(mem.content, embedding, mem.category || 'mobile_sync', deviceId, `${deviceId}:${mem.id}`);
      } catch (e: any) {
        failedMemoryIds.push(mem.id);
        Logger.error('SyncManager', `Failed to ingest memory ${mem.id}: ${e.message}`);
      }
    }
    if ((payload.memories?.length ?? 0) > failedMemoryIds.length) {
      WikiSynthesisService.runCycle().catch(e =>
        Logger.error('SyncManager', `Auto Wiki cycle failed: ${e.message}`)
      );
    }

    const totalSynced = (payload.meetings?.length || 0) + (payload.calendarEvents?.length || 0) + (payload.deletions?.length || 0) +
      (payload.chats?.length || 0) + (payload.memories?.length || 0) - failedMemoryIds.length;
    db.prepare(`
      INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, error_msg, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(logId, deviceId, 'UPLOAD', 'MIXED', totalSynced, 'SUCCESS',
      failedMemoryIds.length ? `${failedMemoryIds.length} memories not ingested` : null, Date.now());

    // Notify other devices via FCM
    this.broadcastSync(deviceId).catch(e =>
      Logger.error('SyncManager', `Broadcast failed: ${e.message}`)
    );
    return { failedMemoryIds };
  }

  /** SQLite part of a push. Upserts only: INSERT OR REPLACE would delete (and CASCADE) rows. */
  private static writePush(payload: SyncPayload, now: number) {
    const { deviceId, timestamp } = payload;

    db.prepare(`
      INSERT INTO sync_cursors (device_id, last_sync_timestamp, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        last_sync_timestamp = excluded.last_sync_timestamp,
        updated_at = excluded.updated_at
    `).run(deviceId, timestamp, now);

    // Meetings: the last device that changed one owns it, so the others pull the change
    const upsertMeeting = db.prepare(`
      INSERT INTO meetings (
        id, device_id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_id = excluded.device_id, timestamp = excluded.timestamp, duration = excluded.duration,
        has_audio = excluded.has_audio, audio_file_path = excluded.audio_file_path,
        audio_mime_type = excluded.audio_mime_type, speaker_names_json = excluded.speaker_names_json,
        updated_at = excluded.updated_at
    `);
    // Deletion is final: a device that has not pulled it yet must not bring the row back
    const tombstoned = db.prepare(`SELECT 1 FROM sync_tombstones WHERE entity_type = ? AND entity_id = ?`);
    for (const m of payload.meetings ?? []) {
      if (tombstoned.get('meeting', m.id)) continue;
      upsertMeeting.run(
        m.id, deviceId, m.timestamp, m.duration, m.has_audio ? 1 : 0,
        m.audio_file_path ?? null, m.audio_mime_type ?? null, m.speaker_names_json ?? null,
        m.created_at || now, now
      );
    }

    // Segments: an edited segment makes its meeting "changed" for the other devices
    const meetingExists = db.prepare(`SELECT 1 FROM meetings WHERE id = ?`);
    const touchMeeting = db.prepare(`UPDATE meetings SET updated_at = ?, device_id = ? WHERE id = ?`);
    const upsertSegment = db.prepare(`
      INSERT INTO meeting_segments (
        id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, stt_provider, confidence, words_json, original_text, is_edited, edited_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        meeting_id = excluded.meeting_id, sequence = excluded.sequence, start_ms = excluded.start_ms,
        end_ms = excluded.end_ms, text = excluded.text, speaker_id = excluded.speaker_id,
        stt_provider = excluded.stt_provider, confidence = excluded.confidence, words_json = excluded.words_json,
        original_text = excluded.original_text, is_edited = excluded.is_edited, edited_at = excluded.edited_at
    `);
    const touched = new Set<string>();
    for (const s of payload.meetingSegments ?? []) {
      // An orphan segment must not fail (and block forever) the whole push
      if (tombstoned.get('segment', s.id)) continue;
      if (!meetingExists.get(s.meeting_id)) {
        Logger.warn('SyncManager', `Segment ${s.id} skipped: meeting ${s.meeting_id} unknown`);
        continue;
      }
      upsertSegment.run(
        s.id, s.meeting_id, s.sequence, s.start_ms, s.end_ms, s.text,
        s.speaker_id ?? null, s.stt_provider ?? null, s.confidence ?? null, s.words_json ?? null,
        s.original_text ?? null, s.is_edited ? 1 : 0, s.edited_at ?? null
      );
      touched.add(s.meeting_id);
    }
    for (const meetingId of touched) touchMeeting.run(now, deviceId, meetingId);

    this.applyDeletions(payload.deletions, deviceId, now, touchMeeting);

    const upsertEvent = db.prepare(`
      INSERT INTO calendar_events (
        id, device_id, title, description, location, start_time, end_time, is_all_day, calendar_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        device_id = excluded.device_id, title = excluded.title, description = excluded.description,
        location = excluded.location, start_time = excluded.start_time, end_time = excluded.end_time,
        is_all_day = excluded.is_all_day, calendar_id = excluded.calendar_id, updated_at = excluded.updated_at
    `);
    for (const e of payload.calendarEvents ?? []) {
      upsertEvent.run(
        e.id, deviceId, e.title, e.description ?? null, e.location ?? null,
        e.start_time, e.end_time, e.is_all_day ? 1 : 0,
        e.calendar_id ?? null, e.created_at || now, now
      );
    }

    // Chats: the creator keeps ownership; a message changes (and is pulled again) only if its text changes
    const upsertConversation = db.prepare(`
      INSERT INTO conversations (id, title, created_at, last_message_at, device_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        last_message_at = MAX(COALESCE(conversations.last_message_at, 0), excluded.last_message_at)
    `);
    const upsertMessage = db.prepare(`
      INSERT INTO direct_chats (id, conversation_id, role, content, used_node, timestamp, device_id, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content = excluded.content, received_at = excluded.received_at
      WHERE direct_chats.content IS NOT excluded.content
    `);
    for (const thread of payload.chats ?? []) {
      const updatedAt = toMs(thread.updated_at, now);
      upsertConversation.run(thread.id, thread.title || 'Untitled Chat', toMs(thread.created_at, updatedAt), updatedAt, deviceId);

      for (const msg of Array.isArray(thread.messages) ? thread.messages : []) {
        // Mobile threads use { role: 'model', text, timestamp: ISO string }
        const content = typeof msg.content === 'string' ? msg.content : typeof msg.text === 'string' ? msg.text : '';
        const ts = toMs(msg.timestamp, now);
        const role = msg.role === 'model' ? 'assistant' : (msg.role || 'user');
        const localId = msg.id ? String(msg.id)
          : crypto.createHash('md5').update(`${role}-${ts}-${content.slice(0, 50)}`).digest('hex');
        upsertMessage.run(chatMessageId(thread.id, localId), thread.id, role, content, msg.used_node ?? null, ts, deviceId, now);
      }
    }
  }

  /**
   * Deletions pushed by a device, applied after its upserts (a meeting created and deleted
   * before syncing must end up deleted) and recorded as tombstones for the other devices.
   * A deleted meeting takes its segments with it (ON DELETE CASCADE).
   */
  private static applyDeletions(deletions: SyncDeletion[] | undefined, deviceId: string, now: number, touchMeeting: { run: (...args: unknown[]) => unknown }) {
    const tombstone = db.prepare(`
      INSERT INTO sync_tombstones (entity_type, entity_id, device_id, deleted_at, received_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        device_id = excluded.device_id, deleted_at = excluded.deleted_at, received_at = excluded.received_at
    `);
    const deleteMeeting = db.prepare(`DELETE FROM meetings WHERE id = ?`);
    const segmentMeeting = db.prepare(`SELECT meeting_id FROM meeting_segments WHERE id = ?`);
    const deleteSegment = db.prepare(`DELETE FROM meeting_segments WHERE id = ?`);
    for (const d of deletions ?? []) {
      if (!d || !DELETION_TYPES.has(d.type) || typeof d.id !== 'string' || !d.id) continue;
      if (d.type === 'meeting') {
        deleteMeeting.run(d.id);
      } else {
        const owner = segmentMeeting.get(d.id) as { meeting_id: string } | undefined;
        deleteSegment.run(d.id);
        if (owner) touchMeeting.run(now, deviceId, owner.meeting_id);
      }
      tombstone.run(d.type, d.id, deviceId, toMs(d.deletedAt, now), now);
    }
  }

  /**
   * Send a silent FCM notification to all mobile devices except the sender.
   */
  private static async broadcastSync(senderDeviceId: string): Promise<void> {
    const mobileNodes = db.prepare("SELECT id, fcm_token FROM nodes WHERE type = 'mobile' AND id != ?").all(senderDeviceId) as any[];

    const sentTokens = new Set<string>();
    for (const node of mobileNodes) {
      if (node.fcm_token && !sentTokens.has(node.fcm_token)) {
        await sendToDevice(node.fcm_token, {
          title: 'Sync Request',
          body: 'New data available on server',
          data: {
            type: 'SYNC_REQUEST',
            sender: senderDeviceId,
            timestamp: Date.now().toString()
          }
        });
        sentTokens.add(node.fcm_token);
      }
    }
  }

  /**
   * Fetch data for a device to pull. `since` and the returned `timestamp` are server
   * time: the device stores the timestamp as is and sends it back on the next pull.
   */
  public static async handlePull(deviceId: string, since: number): Promise<PullResult> {
    // Cursor read BEFORE the queries, and 1 ms behind: rows written later in this same
    // millisecond are in the next pull (a row may arrive twice, devices dedupe by id)
    const timestamp = Date.now() - 1;

    const result = db.transaction((): PullResult => {
      const meetings = db.prepare("SELECT * FROM meetings WHERE updated_at > ? AND device_id != ?").all(since, deviceId) as any[];
      const meetingIds = meetings.map(m => m.id);
      const segments = meetingIds.length === 0 ? [] : db.prepare(
        `SELECT * FROM meeting_segments WHERE meeting_id IN (${meetingIds.map(() => '?').join(',')})`
      ).all(...meetingIds);

      const calendarEvents = db.prepare("SELECT * FROM calendar_events WHERE updated_at > ? AND device_id != ?").all(since, deviceId);
      // received_at is set by the server: the device clock never decides what is "new"
      const chats = db.prepare("SELECT * FROM direct_chats WHERE received_at > ? AND device_id != ? ORDER BY timestamp ASC")
        .all(since, deviceId) as any[];
      const conversationIds = [...new Set(chats.map(c => c.conversation_id).filter(Boolean))];
      const conversations = conversationIds.length === 0 ? [] : db.prepare(
        `SELECT id, title, created_at, last_message_at FROM conversations WHERE id IN (${conversationIds.map(() => '?').join(',')})`
      ).all(...conversationIds) as PullResult['conversations'];

      const deletions = db.prepare(`
        SELECT entity_type AS type, entity_id AS id, deleted_at AS deletedAt FROM sync_tombstones
        WHERE received_at > ? AND device_id != ?
      `).all(since, deviceId) as SyncDeletion[];

      return { deviceId, timestamp, meetings, meetingSegments: segments, calendarEvents, chats, conversations, deletions };
    })();

    const totalDownloaded = result.meetings!.length + result.calendarEvents!.length + result.chats!.length;
    db.prepare(`
      INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), deviceId, 'DOWNLOAD', 'MIXED', totalDownloaded, 'SUCCESS', Date.now());

    return result;
  }
}
