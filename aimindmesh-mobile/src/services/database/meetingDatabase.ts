import { SQLiteDBConnection, capSQLiteSet } from '@capacitor-community/sqlite';
import { DatabaseManager } from './DatabaseManager';
import { logger } from '../logger';
import {
    blockMeetingSaves,
    isMeetingDeleted,
    markMeetingDeleted,
    MeetingDeletedError,
    notifySegmentsDeleted,
    unblockMeetingSaves
} from '../meeting/meetingDeletions';

/** Deletions waiting to be pushed, so other devices and the server drop the same rows. */
export interface SyncDeletion {
    type: 'meeting' | 'segment';
    id: string;
    deletedAt: number;
}


export interface DBMeeting {
    id: string;
    timestamp: number;
    duration: number;
    has_audio: boolean;
    audio_file_path: string | null;
    audio_mime_type: string | null;
    speaker_names_json: string; // JSON string record of idx -> name
}

export interface DBMeetingSegment {
    id: string;
    meeting_id: string;
    sequence: number;
    start_ms: number;
    end_ms: number;
    text: string;
    speaker_id: number;
    stt_provider: string | null;
    confidence: number | null;
    words_json: string | null;
    original_text: string | null;
    is_edited: boolean;
    edited_at: number | null;
}

/**
 * Statements of one meeting save, run as a single transaction. The meeting row is upserted (not
 * REPLACEd: that deletes the row, cascading to the segments and dropping server_id). Audio fields
 * only grow, so a save without new audio keeps the stored file; is_synced = 0 pushes the change.
 */
export function buildMeetingSaveSet(meeting: DBMeeting, segments: DBMeetingSegment[], deletedAt = Date.now()): capSQLiteSet[] {
    const set: capSQLiteSet[] = [
        {
            statement: `INSERT INTO meetings
                (id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json, is_synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE meetings.duration END,
                    has_audio = MAX(meetings.has_audio, excluded.has_audio),
                    audio_file_path = COALESCE(excluded.audio_file_path, meetings.audio_file_path),
                    audio_mime_type = COALESCE(excluded.audio_mime_type, meetings.audio_mime_type),
                    speaker_names_json = excluded.speaker_names_json,
                    is_synced = 0`,
            values: [
                meeting.id,
                meeting.timestamp,
                meeting.duration,
                meeting.has_audio ? 1 : 0,
                meeting.audio_file_path,
                meeting.audio_mime_type,
                meeting.speaker_names_json || '{}'
            ]
        },
        // Every stored segment is tombstoned, then the ones written again lose their tombstone
        // (below): what remains are the segments this save dropped, to be deleted remotely too.
        {
            statement: `INSERT OR REPLACE INTO sync_deletions (entity_type, entity_id, deleted_at)
                SELECT 'segment', id, ? FROM meeting_segments WHERE meeting_id = ?`,
            values: [deletedAt, meeting.id]
        },
        { statement: 'DELETE FROM meeting_segments WHERE meeting_id = ?', values: [meeting.id] }
    ];

    // A duplicated id inside one transcript would abort the whole transaction
    const seen = new Set<string>();
    for (const seg of segments) {
        let id = seg.id;
        if (seen.has(id)) id = `${id}_${seg.sequence}`;
        seen.add(id);
        set.push({
            statement: `INSERT INTO meeting_segments
                (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, stt_provider, confidence, words_json, original_text, is_edited, edited_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            values: [
                id,
                seg.meeting_id,
                seg.sequence,
                seg.start_ms,
                seg.end_ms,
                seg.text,
                seg.speaker_id,
                seg.stt_provider,
                seg.confidence,
                seg.words_json,
                seg.original_text,
                seg.is_edited ? 1 : 0,
                seg.edited_at
            ]
        });
    }
    set.push({
        statement: `DELETE FROM sync_deletions WHERE entity_type = 'segment'
            AND entity_id IN (SELECT id FROM meeting_segments WHERE meeting_id = ?)`,
        values: [meeting.id]
    });
    return set;
}

/** User deletion: the meeting tombstone (covering its segments) is written with the delete. */
export function buildMeetingDeleteSet(meetingId: string, deletedAt = Date.now()): capSQLiteSet[] {
    return [
        {
            statement: `INSERT OR REPLACE INTO sync_deletions (entity_type, entity_id, deleted_at) VALUES ('meeting', ?, ?)`,
            values: [meetingId, deletedAt]
        },
        {
            statement: `DELETE FROM sync_deletions WHERE entity_type = 'segment'
                AND entity_id IN (SELECT id FROM meeting_segments WHERE meeting_id = ?)`,
            values: [meetingId]
        },
        { statement: 'DELETE FROM meeting_segments WHERE meeting_id = ?', values: [meetingId] },
        { statement: 'DELETE FROM meetings WHERE id = ?', values: [meetingId] }
    ];
}

/** Deletions received from sync: applied without tombstones (the remote side already knows). */
export function buildRemoteDeletionSet(meetingIds: string[], segmentIds: string[]): capSQLiteSet[] {
    const set: capSQLiteSet[] = [];
    for (const id of meetingIds) {
        set.push(
            { statement: 'DELETE FROM meeting_segments WHERE meeting_id = ?', values: [id] },
            { statement: 'DELETE FROM meetings WHERE id = ?', values: [id] },
            { statement: `DELETE FROM sync_deletions WHERE entity_type = 'meeting' AND entity_id = ?`, values: [id] }
        );
    }
    for (const id of segmentIds) {
        set.push(
            { statement: 'DELETE FROM meeting_segments WHERE id = ?', values: [id] },
            { statement: `DELETE FROM sync_deletions WHERE entity_type = 'segment' AND entity_id = ?`, values: [id] }
        );
    }
    return set;
}

export class MeetingDatabase {
    private static instance: MeetingDatabase;
    private dbManager: DatabaseManager;
    private initialized: boolean = false;

    private constructor() {
        this.dbManager = DatabaseManager.getInstance();
    }

    public static getInstance(): MeetingDatabase {
        if (!MeetingDatabase.instance) {
            MeetingDatabase.instance = new MeetingDatabase();
        }
        return MeetingDatabase.instance;
    }

    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const db = await this.dbManager.getDatabase('meeting');

            // Create meetings table
            await db.execute(`
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    timestamp INTEGER NOT NULL,
                    duration INTEGER NOT NULL,
                    has_audio INTEGER DEFAULT 0,
                    audio_file_path TEXT,
                    audio_mime_type TEXT,
                    speaker_names_json TEXT,
                    is_synced INTEGER DEFAULT 0,
                    server_id TEXT
                );
            `);

            // Create meeting segments table
            await db.execute(`
                CREATE TABLE IF NOT EXISTS meeting_segments (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    start_ms INTEGER NOT NULL,
                    end_ms INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    speaker_id INTEGER,
                    stt_provider TEXT,
                    confidence REAL,
                    words_json TEXT,
                    original_text TEXT,
                    is_edited INTEGER DEFAULT 0,
                    edited_at INTEGER,
                    is_synced INTEGER DEFAULT 0,
                    server_id TEXT,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );
            `);

            // Tombstones of deleted meetings/segments until sync has pushed them
            await db.execute(`
                CREATE TABLE IF NOT EXISTS sync_deletions (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    deleted_at INTEGER NOT NULL,
                    PRIMARY KEY (entity_type, entity_id)
                );
            `);

            await db.execute(`
                CREATE INDEX IF NOT EXISTS idx_meeting_segments_meeting_id 
                ON meeting_segments(meeting_id, sequence);
            `);

            this.initialized = true;
            logger.log('info', 'MeetingDatabase initialized successfully');

            // ── MIGRATIONS ──────────────────────────────────────────────────
            try {
                const tables = ['meetings', 'meeting_segments'];
                for (const table of tables) {
                    const tableInfo = await db.query(`PRAGMA table_info(${table});`);
                    const columns = tableInfo.values?.map((col: any) => col.name) || [];
                    
                    if (!columns.includes('is_synced')) {
                        logger.log('info', `[MeetingDB] Adding is_synced column to ${table}`);
                        await db.execute(`ALTER TABLE ${table} ADD COLUMN is_synced INTEGER DEFAULT 0;`);
                    }
                    if (!columns.includes('server_id')) {
                        logger.log('info', `[MeetingDB] Adding server_id column to ${table}`);
                        await db.execute(`ALTER TABLE ${table} ADD COLUMN server_id TEXT;`);
                    }
                }
            } catch (migErr) {
                logger.log('warn', '[MeetingDB] Migration failed', migErr);
            }
        } catch (error) {
            logger.log('error', 'Failed to initialize MeetingDatabase', error);
            throw error;
        }
    }

    public async saveMeeting(meeting: DBMeeting, segments: DBMeetingSegment[]): Promise<void> {
        await this.initialize();
        const set = buildMeetingSaveSet(meeting, segments);

        try {
            // One serialized transaction: separate statements left a meeting without segments
            // when the insert failed after the delete, or when two saves interleaved.
            await this.dbManager.serializedWrite('meeting', db => {
                // Checked in the queue: a save queued before a deletion must not recreate the meeting
                if (isMeetingDeleted(meeting.id)) throw new MeetingDeletedError(meeting.id);
                return db.executeSet(set, true);
            });
            logger.log('info', `Saved meeting ${meeting.id} with ${segments.length} segments to SQLite`);
        } catch (error) {
            logger.log('error', 'Failed to save meeting to DB', error);
            throw error;
        }
    }

    /** All segments in one query, grouped by meeting (loading the history did one query per meeting). */
    public async getAllSegmentsByMeeting(): Promise<Map<string, DBMeetingSegment[]>> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        const grouped = new Map<string, DBMeetingSegment[]>();

        try {
            const res = await db.query('SELECT * FROM meeting_segments ORDER BY meeting_id, sequence ASC');
            for (const row of res.values || []) {
                const segment = { ...row, is_edited: row.is_edited === 1 } as DBMeetingSegment;
                const list = grouped.get(segment.meeting_id);
                if (list) list.push(segment);
                else grouped.set(segment.meeting_id, [segment]);
            }
        } catch (error) {
            logger.log('error', 'Failed to get meeting segments from DB', error);
        }
        return grouped;
    }

    public async getAllMeetings(): Promise<DBMeeting[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');

        try {
            const res = await db.query('SELECT * FROM meetings ORDER BY timestamp DESC');
            return (res.values || []).map(row => ({
                ...row,
                has_audio: row.has_audio === 1
            })) as DBMeeting[];
        } catch (error) {
            logger.log('error', 'Failed to get meetings from DB', error);
            return [];
        }
    }

    public async getMeetingById(id: string): Promise<DBMeeting | null> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');

        try {
            const res = await db.query('SELECT * FROM meetings WHERE id = ?', [id]);
            if (res.values && res.values.length > 0) {
                const row = res.values[0];
                return {
                    ...row,
                    has_audio: row.has_audio === 1
                } as DBMeeting;
            }
            return null;
        } catch (error) {
            logger.log('error', `Failed to get meeting ${id} from DB`, error);
            return null;
        }
    }

    public async getMeetingSegments(meetingId: string): Promise<DBMeetingSegment[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');

        try {
            const res = await db.query('SELECT * FROM meeting_segments WHERE meeting_id = ? ORDER BY sequence ASC', [meetingId]);
            return (res.values || []).map(row => ({
                ...row,
                is_edited: row.is_edited === 1
            })) as DBMeetingSegment[];
        } catch (error) {
            logger.log('error', `Failed to get segments for meeting ${meetingId}`, error);
            return [];
        }
    }

    /** Deletes a meeting and its segments, leaving a tombstone for sync, in one transaction. */
    public async deleteMeeting(id: string): Promise<void> {
        await this.initialize();
        // Saves are refused from now on: an autosave of the open meeting must not recreate it
        blockMeetingSaves(id);
        try {
            await this.dbManager.serializedWrite('meeting', db => db.executeSet(buildMeetingDeleteSet(id), true));
            logger.log('info', `Deleted meeting ${id} from DB`);
        } catch (error) {
            unblockMeetingSaves(id);
            logger.log('error', `Failed to delete meeting ${id}`, error);
            throw error;
        }
        markMeetingDeleted(id);
    }

    /** Applies deletions made on other devices (rows only: files are the storage layer's job). */
    public async deleteRemote(meetingIds: string[], segmentIds: string[]): Promise<void> {
        if (meetingIds.length === 0 && segmentIds.length === 0) return;
        await this.initialize();
        meetingIds.forEach(blockMeetingSaves);
        try {
            const set = buildRemoteDeletionSet(meetingIds, segmentIds);
            await this.dbManager.serializedWrite('meeting', db => db.executeSet(set, true));
        } catch (error) {
            meetingIds.forEach(unblockMeetingSaves);
            throw error;
        }
        meetingIds.forEach(markMeetingDeleted);
        notifySegmentsDeleted(segmentIds);
    }

    public async getSyncDeletions(): Promise<SyncDeletion[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        const res = await db.query('SELECT entity_type, entity_id, deleted_at FROM sync_deletions ORDER BY deleted_at ASC');
        return (res.values || [])
            .filter(row => row.entity_type === 'meeting' || row.entity_type === 'segment')
            .map(row => ({ type: row.entity_type, id: row.entity_id, deletedAt: row.deleted_at }));
    }

    public async clearSyncDeletions(items: Array<{ type: 'meeting' | 'segment'; id: string }>): Promise<void> {
        if (items.length === 0) return;
        await this.initialize();
        const set = items.map(item => ({
            statement: 'DELETE FROM sync_deletions WHERE entity_type = ? AND entity_id = ?',
            values: [item.type, item.id]
        }));
        await this.dbManager.serializedWrite('meeting', db => db.executeSet(set, true));
    }

    public async hasSyncDeletion(type: 'meeting' | 'segment', id: string): Promise<boolean> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        const res = await db.query('SELECT 1 FROM sync_deletions WHERE entity_type = ? AND entity_id = ?', [type, id]);
        return (res.values || []).length > 0;
    }

    /**
     * Gives a meeting the audio recovered from an interrupted recording, creating the meeting when
     * no transcript checkpoint was saved before the app was killed.
     */
    public async attachRecoveredAudio(meeting: { id: string; timestamp: number; durationSec: number; audioPath: string; mimeType: string }): Promise<void> {
        await this.initialize();
        await this.dbManager.serializedWrite('meeting', db => {
            if (isMeetingDeleted(meeting.id)) throw new MeetingDeletedError(meeting.id);
            return db.run(
                `INSERT INTO meetings (id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json, is_synced)
                 VALUES (?, ?, ?, 1, ?, ?, '{}', 0)
                 ON CONFLICT(id) DO UPDATE SET
                    duration = MAX(meetings.duration, excluded.duration),
                    has_audio = 1,
                    audio_file_path = excluded.audio_file_path,
                    audio_mime_type = excluded.audio_mime_type,
                    is_synced = 0`,
                [meeting.id, meeting.timestamp, meeting.durationSec, meeting.audioPath, meeting.mimeType]
            );
        });
    }

    public async updateSegmentText(segmentId: string, _meetingId: string, newText: string): Promise<void> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');

        try {
            // First get the segment to check if we need to store original_text
            const res = await db.query('SELECT original_text, text FROM meeting_segments WHERE id = ?', [segmentId]);

            if (res.values && res.values.length > 0) {
                const current = res.values[0];
                const originalText = current.original_text || current.text;

                await db.run(
                    `UPDATE meeting_segments 
                     SET text = ?, is_edited = 1, edited_at = ?, original_text = ?, is_synced = 0
                     WHERE id = ?`, // is_synced = 0: the correction is pushed at the next sync
                    [newText, Date.now(), originalText, segmentId]
                );

                logger.log('info', `Updated segment ${segmentId} text`);
            }
        } catch (error) {
            logger.log('error', `Failed to update segment ${segmentId}`, error);
            throw error;
        }
    }
}

/**
 * Global helper to get the raw database connection
 */
export async function getMeetingDatabase(): Promise<SQLiteDBConnection> {
    const instance = MeetingDatabase.getInstance();
    await instance.initialize();
    return DatabaseManager.getInstance().getDatabase('meeting');
}

/** Tombstones to push (GlobalSyncService sends them as `deletions`). */
export async function getPendingSyncDeletions(): Promise<SyncDeletion[]> {
    return MeetingDatabase.getInstance().getSyncDeletions();
}

/** Called after a successful push. */
export async function clearSyncDeletions(items: Array<{ type: 'meeting' | 'segment'; id: string }>): Promise<void> {
    return MeetingDatabase.getInstance().clearSyncDeletions(items);
}

/**
 * Deletions pulled from the server: rows go without new tombstones, a deleted meeting also loses
 * its audio file, and an open Meeting mode resets (or detaches a recording in progress).
 */
export async function applyRemoteDeletions(items: SyncDeletion[]): Promise<void> {
    const meetingIds = [...new Set(items.filter(i => i.type === 'meeting').map(i => i.id))];
    const segmentIds = [...new Set(items.filter(i => i.type === 'segment').map(i => i.id))];
    await MeetingDatabase.getInstance().deleteRemote(meetingIds, segmentIds);
    if (meetingIds.length > 0) {
        // Dynamic: meetingStorage imports this module
        const { deleteMeetingFiles } = await import('../meeting/meetingStorage');
        for (const id of meetingIds) await deleteMeetingFiles(id);
    }
}
