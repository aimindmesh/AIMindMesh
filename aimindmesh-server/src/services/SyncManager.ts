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
}

export class SyncManager {
  /**
   * Process incoming data from a mobile device.
   * Updates SQLite, triggers Neo4j ingestion, and notifies other devices via FCM.
   */
  public static async handlePush(payload: SyncPayload): Promise<void> {
    const { deviceId, timestamp } = payload;
    const logId = crypto.randomUUID();
    let totalSynced = 0;

    try {
      Logger.info('SyncManager', `Received push from ${deviceId} (ts: ${timestamp})`);

    // 1. Update Sync Cursor
    db.prepare(`
      INSERT INTO sync_cursors (device_id, last_sync_timestamp, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        last_sync_timestamp = excluded.last_sync_timestamp,
        updated_at = excluded.updated_at
    `).run(deviceId, timestamp, Date.now());

    // 2. Sync Meetings
    if (payload.meetings && payload.meetings.length > 0) {
      const insertMeeting = db.prepare(`
        INSERT OR REPLACE INTO meetings (
          id, device_id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const m of payload.meetings) {
        insertMeeting.run(
          m.id, deviceId, m.timestamp, m.duration, m.has_audio ? 1 : 0,
          m.audio_file_path, m.audio_mime_type, m.speaker_names_json,
          m.created_at || Date.now(), Date.now()
        );
      }
    }

    // 3. Sync Meeting Segments
    if (payload.meetingSegments && payload.meetingSegments.length > 0) {
      const insertSegment = db.prepare(`
        INSERT OR REPLACE INTO meeting_segments (
          id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, stt_provider, confidence, words_json, original_text, is_edited, edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const s of payload.meetingSegments) {
        insertSegment.run(
          s.id, s.meeting_id, s.sequence, s.start_ms, s.end_ms, s.text,
          s.speaker_id, s.stt_provider, s.confidence, s.words_json,
          s.original_text, s.is_edited ? 1 : 0, s.edited_at
        );
      }
    }

    // 4. Sync Calendar Events
    if (payload.calendarEvents && payload.calendarEvents.length > 0) {
      const insertEvent = db.prepare(`
        INSERT OR REPLACE INTO calendar_events (
          id, device_id, title, description, location, start_time, end_time, is_all_day, calendar_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const e of payload.calendarEvents) {
        insertEvent.run(
          e.id, deviceId, e.title, e.description, e.location,
          e.start_time, e.end_time, e.is_all_day ? 1 : 0,
          e.calendar_id, e.created_at || Date.now(), Date.now()
        );
      }
    }

    // 5. Sync Chats (Conversations & Direct Chats)
    if (payload.chats && payload.chats.length > 0) {
      const insertConversation = db.prepare(`
        INSERT OR REPLACE INTO conversations (
          id, title, created_at, last_message_at, device_id
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const insertDirectChat = db.prepare(`
        INSERT OR REPLACE INTO direct_chats (
          id, conversation_id, role, content, used_node, timestamp, device_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const thread of payload.chats) {
        // Insert Conversation
        insertConversation.run(
          thread.id, 
          thread.title || 'Untitled Chat', 
          thread.created_at || thread.updated_at || Date.now(),
          thread.updated_at || Date.now(),
          deviceId
        );

        // Insert Messages
        if (thread.messages && Array.isArray(thread.messages)) {
          for (const msg of thread.messages) {
            // Generate a stable ID for the message if missing (e.g. hash of content+timestamp)
            const msgId = msg.id || crypto.createHash('md5').update(`${thread.id}-${msg.role}-${msg.timestamp}-${msg.content.slice(0, 50)}`).digest('hex');
            
            insertDirectChat.run(
              msgId,
              thread.id,
              msg.role || 'user',
              msg.content || '',
              msg.used_node || null,
              msg.timestamp || Date.now(),
              deviceId
            );
          }
        }
      }
    }

    // 6. Sync Memories (Knowledge Ingestion)
    if (payload.memories && payload.memories.length > 0) {
      for (const mem of payload.memories) {
        try {
          await KGManager.upsertMemory(
            mem.content,
            mem.embedding, // Assuming Float32Array already converted or passed as number[]
            mem.category || 'mobile_sync',
            deviceId
          );
        } catch (e: any) {
          Logger.error('SyncManager', `Failed to ingest memory ${mem.id}: ${e.message}`);
        }
      }
      // Trigger a wiki cycle if memories were added
      WikiSynthesisService.runCycle().catch(e => 
        Logger.error('SyncManager', `Auto Wiki cycle failed: ${e.message}`)
      );
    }

    totalSynced = (payload.meetings?.length || 0) + (payload.calendarEvents?.length || 0) + (payload.chats?.length || 0) + (payload.memories?.length || 0);

    // 7. Log Success
    db.prepare(`
      INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(logId, deviceId, 'UPLOAD', 'MIXED', totalSynced, 'SUCCESS', Date.now());

    // 8. Notify other devices via FCM
    this.broadcastSync(deviceId).catch(e => 
      Logger.error('SyncManager', `Broadcast failed: ${e.message}`)
    );
  } catch (err: any) {
    Logger.error('SyncManager', `Critical push failure from ${deviceId}: ${err.message}`);
    db.prepare(`
      INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, error_msg, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(logId, deviceId, 'UPLOAD', 'MIXED', 0, 'FAILED', err.message, Date.now());
    throw err;
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
   * Fetch data for a device to pull.
   */
  public static async handlePull(deviceId: string, since: number): Promise<SyncPayload> {
    const meetings = db.prepare("SELECT * FROM meetings WHERE updated_at > ? AND device_id != ?").all(since, deviceId);
    const meetingIds = meetings.map((m: any) => m.id);
    
    let segments: any[] = [];
    if (meetingIds.length > 0) {
      const placeholders = meetingIds.map(() => '?').join(',');
      segments = db.prepare(`SELECT * FROM meeting_segments WHERE meeting_id IN (${placeholders})`).all(meetingIds);
    }

    const calendarEvents = db.prepare("SELECT * FROM calendar_events WHERE updated_at > ? AND device_id != ?").all(since, deviceId);
    const chats = db.prepare("SELECT * FROM direct_chats WHERE timestamp > ? AND device_id != ?").all(since, deviceId);

    const result = {
      deviceId,
      timestamp: Date.now(),
      meetings,
      meetingSegments: segments,
      calendarEvents,
      chats
    };

    const totalDownloaded = meetings.length + calendarEvents.length + chats.length;
    
    // Log Download
    db.prepare(`
      INSERT INTO sync_logs (id, device_id, direction, entity_type, count, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), deviceId, 'DOWNLOAD', 'MIXED', totalDownloaded, 'SUCCESS', Date.now());

    return result;
  }
}
