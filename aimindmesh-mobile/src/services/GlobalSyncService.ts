import { Device } from '@capacitor/device';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SyncPullResponse, SyncPushResponse } from '@aimindmesh/api-types';
import { getMeetingDatabase, getPendingSyncDeletions, clearSyncDeletions, applyRemoteDeletions } from './database/meetingDatabase';
import { getMemoryDatabase, blobToFloat32Array } from './memory/memoryDatabase';
import { listCalendarEvents, calendarEventSyncId } from './calendar';
import { AIMindMeshServerSettings } from '../types';
import { readSetting } from './security/secretStore';

const THREADS_KEY = 'conversation-threads';
/** Phone clock: threads changed after it are pushed (compared with the phone's own updatedAt) */
const PUSH_CURSOR_KEY = 'sync_push_cursor';
/** Server clock: the `timestamp` of the last pull, sent back as `since` */
const PULL_CURSOR_KEY = 'sync_pull_cursor';
/** Shown in the settings panel */
const LAST_SYNC_KEY = 'last_sync_timestamp';

export interface SyncResult {
    ok: boolean;
    error?: string;
}

const readNumber = (key: string) => {
    const value = parseInt(localStorage.getItem(key) || '0', 10);
    return Number.isFinite(value) ? value : 0;
};
const toMs = (value: unknown) => {
    const ms = typeof value === 'number' ? value : new Date(value as string).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

/** `UPDATE table SET is_synced = 1 WHERE id IN (?, ?, ...)` with bound ids */
async function markSynced(db: SQLiteDBConnection, table: string, ids: string[]) {
    if (ids.length === 0) return;
    await db.run(`UPDATE ${table} SET is_synced = 1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

export class GlobalSyncService {
    private static isSyncing = false;

    /**
     * Perform a full bidirectional sync with the server.
     * Never throws: the outcome is returned (and logged) so the UI can show it.
     */
    public static async performSync(serverSettings?: AIMindMeshServerSettings): Promise<SyncResult> {
        if (this.isSyncing) {
            return { ok: false, error: 'A sync is already running' };
        }
        this.isSyncing = true;

        try {
            // Self-load settings if not provided (e.g. when called from FCM listener), with the API key
            if (!serverSettings) {
                serverSettings = readSetting<AIMindMeshServerSettings | undefined>('aimindmesh-server-settings', undefined);
            }
            if (!serverSettings?.serverUrl || !serverSettings?.enabled) {
                return { ok: false, error: 'Server sync is disabled or the server URL is missing' };
            }

            const baseUrl = serverSettings.serverUrl.replace(/\/$/, '');
            const headers = { 'x-api-key': serverSettings.apiKey };
            const deviceId = (await Device.getId()).identifier;

            // 1. Push. The cursor is read BEFORE collecting: a thread changed meanwhile goes next time
            const pushStartedAt = Date.now();
            const payload = await this.collectLocalChanges(deviceId, readNumber(PUSH_CURSOR_KEY));
            const hasChanges = ['meetings', 'meetingSegments', 'memories', 'calendarEvents', 'chats', 'deletions']
                .some(key => payload[key]?.length > 0);

            if (hasChanges) {
                const pushResp = await fetch(`${baseUrl}/api/sync/push`, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!pushResp.ok) {
                    throw new Error(`Push failed: ${pushResp.status} ${await pushResp.text()}`);
                }
                const pushed: Partial<SyncPushResponse> = await pushResp.json().catch(() => ({}));
                await this.markItemsAsSynced(payload, pushed.failedMemoryIds ?? []);
                // Pushed deletions are tombstones on the server now
                await clearSyncDeletions(payload.deletions);
            }
            localStorage.setItem(PUSH_CURSOR_KEY, String(pushStartedAt));

            // 2. Pull since the server timestamp of the previous pull
            const pullUrl = `${baseUrl}/api/sync/pull?deviceId=${encodeURIComponent(deviceId)}&since=${readNumber(PULL_CURSOR_KEY)}`;
            const pullResp = await fetch(pullUrl, { headers });
            if (!pullResp.ok) {
                throw new Error(`Pull failed: ${pullResp.status}`);
            }
            const incoming: SyncPullResponse = await pullResp.json();
            await this.mergeIncomingData(incoming);
            if (typeof incoming.timestamp === 'number') {
                localStorage.setItem(PULL_CURSOR_KEY, String(incoming.timestamp));
            }

            localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
            console.log(`[AI Mind Mesh] [Sync] Complete: pushed ${hasChanges ? 'changes' : 'nothing'}, pulled ${incoming.meetings?.length || 0} meetings and ${incoming.chats?.length || 0} messages`);
            return { ok: true };
        } catch (error: any) {
            console.error('[AI Mind Mesh] [Sync] Sync failed', error);
            return { ok: false, error: error?.message || String(error) };
        } finally {
            this.isSyncing = false;
        }
    }

    private static async collectLocalChanges(deviceId: string, pushCursor: number): Promise<any> {
        const payload: any = { deviceId, timestamp: Date.now() };

        const meetingDb = await getMeetingDatabase();
        payload.meetings = (await meetingDb.query('SELECT * FROM meetings WHERE is_synced = 0')).values || [];
        payload.meetingSegments = (await meetingDb.query('SELECT * FROM meeting_segments WHERE is_synced = 0')).values || [];

        // Documents are not synced: the server has no handler for them

        // Memories: the embedding BLOB is sent as numbers, not as raw bytes
        const memoryDb = await getMemoryDatabase();
        const memories = (await memoryDb.query('SELECT id, content, embedding, category FROM memories WHERE is_synced = 0')).values || [];
        payload.memories = memories.map((m: any) => ({
            id: m.id,
            content: m.content,
            category: m.category,
            embedding: Array.from(blobToFloat32Array(m.embedding)),
        }));

        try {
            const start = new Date();
            start.setDate(start.getDate() - 7);
            const end = new Date();
            end.setDate(end.getDate() + 30);
            const calendarEvents = await listCalendarEvents(start, end);
            payload.calendarEvents = calendarEvents.map(e => ({
                id: calendarEventSyncId(deviceId, e),
                title: e.title,
                description: e.notes,
                location: e.location,
                start_time: e.startDate.getTime(),
                end_time: e.endDate.getTime(),
                is_all_day: e.isAllDay ? 1 : 0
            }));
        } catch (calErr) {
            console.error('[AI Mind Mesh] [Sync] Calendar query failed:', calErr);
            payload.calendarEvents = [];
        }

        // Chats: threads keep dates as ISO strings in localStorage, so they are converted to compare
        const threads = JSON.parse(localStorage.getItem(THREADS_KEY) || '[]');
        payload.chats = threads
            .filter((t: any) => toMs(t.updatedAt) > pushCursor)
            .map((t: any) => ({
                id: t.id,
                title: t.title,
                created_at: toMs(t.createdAt),
                updated_at: toMs(t.updatedAt),
                // Text only: hidden trigger messages and attachments stay on the device
                messages: (t.messages || [])
                    .filter((m: any) => !m.hidden && typeof m.text === 'string' && m.text.length > 0)
                    .map((m: any) => ({ id: m.id, role: m.role, content: m.text, timestamp: toMs(m.timestamp) })),
            }));

        // Meetings and segments deleted here: the server forwards them to the other devices
        payload.deletions = await getPendingSyncDeletions();

        return payload;
    }

    private static async markItemsAsSynced(payload: any, failedMemoryIds: string[]): Promise<void> {
        const meetingDb = await getMeetingDatabase();
        await markSynced(meetingDb, 'meetings', (payload.meetings || []).map((m: any) => m.id));
        await markSynced(meetingDb, 'meeting_segments', (payload.meetingSegments || []).map((s: any) => s.id));

        // Memories the server could not store stay unsynced and are pushed again
        const memoryDb = await getMemoryDatabase();
        const failed = new Set(failedMemoryIds);
        await markSynced(memoryDb, 'memories', (payload.memories || []).map((m: any) => m.id).filter((id: string) => !failed.has(id)));
    }

    private static async mergeIncomingData(incoming: SyncPullResponse): Promise<void> {
        // Deletions made on other devices first (never pushed back: no local tombstone is written)
        if (incoming.deletions?.length) await applyRemoteDeletions(incoming.deletions);
        // A local deletion not pushed yet must not be undone by the pull
        const pending = await getPendingSyncDeletions();
        const deletedHere = new Set(pending.map(d => `${d.type}:${d.id}`));

        const meetingDb = await getMeetingDatabase();
        // Upserts: INSERT OR REPLACE would delete (ON DELETE CASCADE) the local segments.
        // Rows with local changes not pushed yet (is_synced = 0) are left as they are.
        for (const m of incoming.meetings || []) {
            if (deletedHere.has(`meeting:${m.id}`)) continue;
            await meetingDb.run(
                `INSERT INTO meetings (id, timestamp, duration, has_audio, speaker_names_json, is_synced, server_id)
                 VALUES (?, ?, ?, ?, ?, 1, ?)
                 ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, duration = excluded.duration,
                   has_audio = excluded.has_audio, speaker_names_json = excluded.speaker_names_json, server_id = excluded.server_id
                 WHERE meetings.is_synced = 1`,
                [m.id, m.timestamp, m.duration, m.has_audio, m.speaker_names_json, m.id]
            );
        }
        for (const s of incoming.meetingSegments || []) {
            if (deletedHere.has(`segment:${s.id}`) || deletedHere.has(`meeting:${s.meeting_id}`)) continue;
            await meetingDb.run(
                `INSERT INTO meeting_segments (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, original_text, is_edited, edited_at, is_synced, server_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                 ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
                   text = excluded.text, speaker_id = excluded.speaker_id, original_text = excluded.original_text,
                   is_edited = excluded.is_edited, edited_at = excluded.edited_at, server_id = excluded.server_id
                 WHERE meeting_segments.is_synced = 1`,
                [s.id, s.meeting_id, s.sequence, s.start_ms, s.end_ms, s.text, s.speaker_id, s.original_text ?? null, s.is_edited ?? 0, s.edited_at ?? null, s.id]
            );
        }

        this.mergeChats(incoming);
    }

    /** Pulled messages go into the thread of their conversation, once (ids are compared namespaced). */
    private static mergeChats(incoming: SyncPullResponse) {
        if (!incoming.chats?.length) return;
        const threads: any[] = JSON.parse(localStorage.getItem(THREADS_KEY) || '[]');
        const titles = new Map((incoming.conversations || []).map(c => [c.id, c]));
        let changed = false;

        for (const msg of incoming.chats) {
            const conversationId = msg.conversation_id;
            if (!conversationId) continue;
            let thread = threads.find(t => t.id === conversationId);
            if (!thread) {
                const meta = titles.get(conversationId);
                thread = {
                    id: conversationId,
                    title: meta?.title || 'Remote Chat',
                    createdAt: new Date(meta?.created_at || msg.timestamp).toISOString(),
                    updatedAt: new Date(msg.timestamp).toISOString(),
                    messages: [],
                    preview: '',
                };
                threads.push(thread);
            }
            // The server stores `${conversationId}:${localId}`: local ids are compared the same way
            const key = (id: string) => (id.startsWith(`${conversationId}:`) ? id : `${conversationId}:${id}`);
            const existing = thread.messages.find((m: any) => key(String(m.id)) === msg.id);
            if (existing) {
                if (existing.text === msg.content) continue;
                existing.text = msg.content;
            } else {
                thread.messages.push({
                    id: msg.id,
                    role: msg.role === 'assistant' ? 'model' : msg.role,
                    text: msg.content,
                    timestamp: new Date(msg.timestamp).toISOString(),
                });
                thread.messages.sort((a: any, b: any) => toMs(a.timestamp) - toMs(b.timestamp));
            }
            if (!thread.preview && msg.role === 'user') thread.preview = msg.content.slice(0, 100);
            if (msg.timestamp > toMs(thread.updatedAt)) thread.updatedAt = new Date(msg.timestamp).toISOString();
            changed = true;
        }

        if (changed) localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
    }
}
