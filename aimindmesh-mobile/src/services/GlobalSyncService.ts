import { Device } from '@capacitor/device';
import { getMeetingDatabase } from './database/meetingDatabase';
import { getKnowledgeDatabase } from './database/knowledgeDatabase';
import { getMemoryDatabase } from './memory/memoryDatabase';
import { listCalendarEvents } from './calendar';
import { AIMindMeshServerSettings } from '../types';

export class GlobalSyncService {
    private static isSyncing = false;

    /**
     * Perform a full bidirectional sync with the server.
     */
    public static async performSync(serverSettings?: AIMindMeshServerSettings): Promise<void> {
        if (this.isSyncing) {
            console.log('[AI Mind Mesh] [Sync] ALREADY SYNCING (early exit)');
            return;
        }
        this.isSyncing = true;
        console.log('[AI Mind Mesh] [Sync] performSync ENTRY POINT');
        
        try {
            // Self-load settings if not provided (e.g. when called from FCM listener)
            if (!serverSettings) {
                console.log('[AI Mind Mesh] [Sync] No settings provided, attempting to load from localStorage...');
                const raw = localStorage.getItem('aimindmesh-server-settings');
                if (raw) {
                    try {
                        serverSettings = JSON.parse(raw);
                        console.log('[AI Mind Mesh] [Sync] Settings loaded from localStorage');
                    } catch (e) {
                        console.error('[AI Mind Mesh] [Sync] Failed to parse settings from localStorage', e);
                    }
                }
            }

            console.log('[AI Mind Mesh] [Sync] performSync validation started');
            if (!serverSettings?.serverUrl || !serverSettings?.enabled) {
                console.warn('[AI Mind Mesh] [Sync] Server sync disabled or URL missing, skipping');
                return;
            }

            console.log('[AI Mind Mesh] [Sync] Checking server reachability at:', serverSettings.serverUrl);
            try {
                const healthResp = await fetch(`${serverSettings.serverUrl.replace(/\/$/, '')}/api/health`, {
                    headers: { 'x-api-key': serverSettings.apiKey }
                });
                console.log('[AI Mind Mesh] [Sync] Health check status:', healthResp.status);
            } catch (healthErr) {
                console.error('[AI Mind Mesh] [Sync] Server unreachable:', healthErr);
                throw new Error('Server unreachable');
            }

            console.log('[AI Mind Mesh] [Sync] Starting global synchronization loop...');
            
            let deviceId;
            try {
                deviceId = await Device.getId();
                console.log('[AI Mind Mesh] [Sync] Device ID retrieved:', deviceId.identifier);
            } catch (deviceErr) {
                console.error('[AI Mind Mesh] [Sync] Failed to get Device ID:', deviceErr);
                throw deviceErr;
            }

            // 1. Collect local changes
            console.log('[AI Mind Mesh] [Sync] Collecting local changes...');
            const payload = await this.collectLocalChanges(deviceId.identifier);
            console.log(`[AI Mind Mesh] [Sync] Collected ${payload.meetings?.length || 0} meetings, ${payload.chats?.length || 0} threads`);

            // 2. Push to server
            if (payload.meetings?.length > 0 || payload.meetingSegments?.length > 0 || 
                payload.documents?.length > 0 || payload.memories?.length > 0 ||
                payload.calendarEvents?.length > 0 || payload.chats?.length > 0) {
                
                console.log('[AI Mind Mesh] [Sync] Pushing changes to server...');
                const pushResp = await fetch(`${serverSettings.serverUrl.replace(/\/$/, '')}/api/sync/push`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': serverSettings.apiKey
                    },
                    body: JSON.stringify(payload)
                });

                if (!pushResp.ok) {
                    const errorText = await pushResp.text();
                    throw new Error(`Push failed: ${pushResp.status} ${errorText}`);
                }
                console.log('[AI Mind Mesh] [Sync] Push successful, marking as synced locally...');
                await this.markItemsAsSynced(payload);
            } else {
                console.log('[AI Mind Mesh] [Sync] No local changes to push.');
            }

            // 3. Pull from server
            console.log('[AI Mind Mesh] [Sync] Pulling updates from server...');
            const lastSync = parseInt(localStorage.getItem('last_sync_timestamp') || '0', 10);
            const pullUrl = `${serverSettings.serverUrl.replace(/\/$/, '')}/api/sync/pull?deviceId=${deviceId.identifier}&since=${lastSync}`;
            
            const pullResp = await fetch(pullUrl, {
                headers: { 'x-api-key': serverSettings.apiKey }
            });

            if (!pullResp.ok) {
                throw new Error(`Pull failed: ${pullResp.status}`);
            }

            const incoming = await pullResp.json();
            console.log(`[AI Mind Mesh] [Sync] Pulled ${incoming.meetings?.length || 0} meetings from server.`);

            // 4. Merge incoming data
            if (incoming.meetings?.length > 0 || incoming.meetingSegments?.length > 0 || 
                incoming.documents?.length > 0 || incoming.memories?.length > 0 || 
                incoming.chats?.length > 0) {
                console.log('[AI Mind Mesh] [Sync] Merging incoming data...');
                await this.mergeIncomingData(incoming);
            }

            localStorage.setItem('last_sync_timestamp', Date.now().toString());
            console.log('[AI Mind Mesh] [Sync] Synchronization complete.');

        } catch (error: any) {
            console.error('[AI Mind Mesh] [Sync] CRITICAL ERROR IN SYNC LOOP', error);
        } finally {
            this.isSyncing = false;
        }
    }

    private static async collectLocalChanges(deviceId: string): Promise<any> {
        const payload: any = { deviceId, timestamp: Date.now() };

        try {
            // Meetings
            console.log('[AI Mind Mesh] [Sync] Querying meetings...');
            const meetingDb = await getMeetingDatabase();
            const unsyncedMeetings = await meetingDb.query("SELECT * FROM meetings WHERE is_synced = 0");
            payload.meetings = unsyncedMeetings.values || [];
            console.log(`[AI Mind Mesh] [Sync] Found ${payload.meetings.length} unsynced meetings`);

            console.log('[AI Mind Mesh] [Sync] Querying meeting segments...');
            const unsyncedSegments = await meetingDb.query("SELECT * FROM meeting_segments WHERE is_synced = 0");
            payload.meetingSegments = unsyncedSegments.values || [];
            console.log(`[AI Mind Mesh] [Sync] Found ${payload.meetingSegments.length} unsynced segments`);

            // Knowledge (Documents)
            console.log('[AI Mind Mesh] [Sync] Querying knowledge documents...');
            const knowledgeDb = await getKnowledgeDatabase();
            const unsyncedDocs = await knowledgeDb.query("SELECT * FROM documents WHERE is_synced = 0");
            payload.documents = unsyncedDocs.values || [];
            console.log(`[AI Mind Mesh] [Sync] Found ${payload.documents.length} unsynced documents`);

            // Memories
            console.log('[AI Mind Mesh] [Sync] Querying memories...');
            const memoryDb = await getMemoryDatabase();
            const unsyncedMemories = await memoryDb.query("SELECT * FROM memories WHERE is_synced = 0");
            payload.memories = unsyncedMemories.values || [];
            console.log(`[AI Mind Mesh] [Sync] Found ${payload.memories.length} unsynced memories`);

            // Calendar
            console.log('[AI Mind Mesh] [Sync] Querying calendar...');
            try {
                const start = new Date();
                start.setDate(start.getDate() - 7);
                const end = new Date();
                end.setDate(end.getDate() + 30);
                const calendarEvents = await listCalendarEvents(start, end);
                payload.calendarEvents = calendarEvents.map(e => ({
                    id: `${deviceId}_${e.startDate.getTime()}`,
                    title: e.title,
                    description: e.notes,
                    location: e.location,
                    start_time: e.startDate.getTime(),
                    end_time: e.endDate.getTime(),
                    is_all_day: e.isAllDay ? 1 : 0
                }));
                console.log(`[AI Mind Mesh] [Sync] Found ${payload.calendarEvents.length} calendar events`);
            } catch (calErr) {
                console.error('[AI Mind Mesh] [Sync] Calendar query failed:', calErr);
                payload.calendarEvents = [];
            }

            // Chats
            console.log('[AI Mind Mesh] [Sync] Collecting chats...');
            const lastSyncTs = parseInt(localStorage.getItem('last_sync_timestamp') || '0', 10);
            const threads = JSON.parse(localStorage.getItem('conversation-threads') || '[]');
            
            // Only sync threads updated since last sync
            const unsyncedThreads = threads.filter((t: any) => (t.updatedAt || 0) > lastSyncTs);
            
            payload.chats = unsyncedThreads.map((t: any) => ({
                id: t.id,
                conversation_id: t.id,
                title: t.title,
                messages: t.messages,
                created_at: t.createdAt,
                updated_at: t.updatedAt
            }));
            console.log(`[AI Mind Mesh] [Sync] Collected ${payload.chats.length} unsynced chat threads`);

        } catch (collectErr) {
            console.error('[AI Mind Mesh] [Sync] Collection failed:', collectErr);
            throw collectErr;
        }

        return payload;
    }

    private static async markItemsAsSynced(payload: any): Promise<void> {
        try {
            console.log('[AI Mind Mesh] [Sync] Marking meetings as synced...');
            const meetingDb = await getMeetingDatabase();
            if (payload.meetings?.length > 0) {
                const ids = payload.meetings.map((m: any) => `'${m.id}'`).join(',');
                await meetingDb.execute(`UPDATE meetings SET is_synced = 1 WHERE id IN (${ids})`);
            }
            if (payload.meetingSegments?.length > 0) {
                const ids = payload.meetingSegments.map((s: any) => `'${s.id}'`).join(',');
                await meetingDb.execute(`UPDATE meeting_segments SET is_synced = 1 WHERE id IN (${ids})`);
            }

            console.log('[AI Mind Mesh] [Sync] Marking documents as synced...');
            const knowledgeDb = await getKnowledgeDatabase();
            if (payload.documents?.length > 0) {
                const ids = payload.documents.map((d: any) => d.id).join(',');
                await knowledgeDb.execute(`UPDATE documents SET is_synced = 1 WHERE id IN (${ids})`);
            }

            console.log('[AI Mind Mesh] [Sync] Marking memories as synced...');
            const memoryDb = await getMemoryDatabase();
            if (payload.memories?.length > 0) {
                const ids = payload.memories.map((m: any) => `'${m.id}'`).join(',');
                await memoryDb.execute(`UPDATE memories SET is_synced = 1 WHERE id IN (${ids})`);
            }
        } catch (markErr) {
            console.error('[AI Mind Mesh] [Sync] Marking failed:', markErr);
        }
    }

    private static async mergeIncomingData(incoming: any): Promise<void> {
        try {
            console.log('[AI Mind Mesh] [Sync] Merging meetings...');
            const meetingDb = await getMeetingDatabase();
            for (const m of (incoming.meetings || [])) {
                await meetingDb.run(
                    `INSERT OR REPLACE INTO meetings (id, timestamp, duration, has_audio, speaker_names_json, is_synced, server_id)
                     VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [m.id, m.timestamp, m.duration, m.has_audio, m.speaker_names_json, m.id]
                );
            }

            for (const s of (incoming.meetingSegments || [])) {
                await meetingDb.run(
                    `INSERT OR REPLACE INTO meeting_segments (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, is_synced, server_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
                    [s.id, s.meeting_id, s.sequence, s.start_ms, s.end_ms, s.text, s.speaker_id, s.id]
                );
            }
            console.log('[AI Mind Mesh] [Sync] Merging chats...');
            const existingThreads = JSON.parse(localStorage.getItem('conversation-threads') || '[]');
            let changed = false;

            for (const incomingThread of (incoming.chats || [])) {
                const idx = existingThreads.findIndex((t: any) => t.id === incomingThread.conversation_id);
                if (idx === -1) {
                    existingThreads.push({
                        id: incomingThread.conversation_id,
                        title: incomingThread.title || 'Remote Chat',
                        messages: [], // We pull full messages later or handle as needed
                        createdAt: Date.now(),
                        updatedAt: incomingThread.timestamp
                    });
                    changed = true;
                } else if (incomingThread.timestamp > (existingThreads[idx].updatedAt || 0)) {
                    // Update existing if newer
                    existingThreads[idx].updatedAt = incomingThread.timestamp;
                    changed = true;
                }
            }

            if (changed) {
                localStorage.setItem('conversation-threads', JSON.stringify(existingThreads));
            }

        } catch (mergeErr) {
            console.error('[AI Mind Mesh] [Sync] Merge failed:', mergeErr);
        }
    }
}
