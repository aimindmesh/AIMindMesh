import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { DatabaseManager } from './DatabaseManager';
import { logger } from '../logger';
import { createMeetingTables } from './meetingSchema';
import {
    buildMarkMeetingAudioStatement,
    buildMeetingDeleteSet,
    buildMeetingSaveSet,
    buildRemoteDeletionSet,
    buildSearchSegmentsQuery,
    buildUpdateNotesStatement,
    buildUpdateVoicesStatement,
    DBMeeting,
    DBMeetingListRow,
    DBMeetingSegment,
    DBSegmentMatch,
    LIST_MEETINGS_QUERY,
    MeetingNotesColumns
} from './meetingStatements';
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

// Row types and statement builders live in meetingStatements (pure, tested): re-exported here
export type { DBMeeting, DBMeetingSegment, DBMeetingListRow, DBSegmentMatch, MeetingNotesColumns } from './meetingStatements';
export { buildMeetingSaveSet, buildMeetingDeleteSet, buildRemoteDeletionSet } from './meetingStatements';

export class MeetingDatabase {
    private static instance: MeetingDatabase;
    private dbManager: DatabaseManager;
    private initPromise: Promise<void> | null = null;

    private constructor() {
        this.dbManager = DatabaseManager.getInstance();
    }

    public static getInstance(): MeetingDatabase {
        if (!MeetingDatabase.instance) {
            MeetingDatabase.instance = new MeetingDatabase();
        }
        return MeetingDatabase.instance;
    }

    /** Creates and migrates the tables once; concurrent callers share the same run. */
    public initialize(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                const db = await this.dbManager.getDatabase('meeting');
                await createMeetingTables(db, fn => this.dbManager.serializedWrite('meeting', fn));
                logger.log('info', 'MeetingDatabase initialized successfully');
            })().catch(error => {
                this.initPromise = null;
                logger.log('error', 'Failed to initialize MeetingDatabase', error);
                throw error;
            });
        }
        return this.initPromise;
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
     * Gives a meeting its recording (finished, or recovered from an interrupted one) without
     * touching its transcript or notes, creating the meeting when no transcript was saved before.
     */
    public async attachRecoveredAudio(meeting: { id: string; timestamp: number; durationSec: number; audioPath: string; mimeType: string }): Promise<void> {
        await this.initialize();
        const { statement, values } = buildMarkMeetingAudioStatement({
            meetingId: meeting.id,
            startedAt: meeting.timestamp,
            durationSec: meeting.durationSec,
            audioFilePath: meeting.audioPath,
            mimeType: meeting.mimeType
        });
        await this.dbManager.serializedWrite('meeting', db => {
            if (isMeetingDeleted(meeting.id)) throw new MeetingDeletedError(meeting.id);
            return db.run(statement, values);
        });
    }

    /** Updates a meeting's title, bookmarks, analysis or questions without touching the rest. */
    public async updateNotes(meetingId: string, notes: MeetingNotesColumns): Promise<void> {
        const update = buildUpdateNotesStatement(meetingId, notes);
        if (!update) return;
        await this.initialize();
        await this.dbManager.serializedWrite('meeting', db => {
            if (isMeetingDeleted(meetingId)) throw new MeetingDeletedError(meetingId);
            return db.run(update.statement, update.values);
        });
    }

    /** Stores the average voice of each speaker of a meeting (local data: not marked for sync). */
    public async updateVoices(meetingId: string, voicesJson: string | null): Promise<void> {
        await this.initialize();
        const { statement, values } = buildUpdateVoicesStatement(meetingId, voicesJson);
        await this.dbManager.serializedWrite('meeting', db => db.run(statement, values));
    }

    /** All meetings, newest first, with segment and speaker counts but no transcripts. */
    public async listMeetings(): Promise<DBMeetingListRow[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        const res = await db.query(LIST_MEETINGS_QUERY);
        return (res.values || []).map(row => ({ ...row, has_audio: row.has_audio === 1 })) as DBMeetingListRow[];
    }

    /** Transcript segments containing `query`, newest meetings first. */
    public async searchSegments(query: string, limit?: number): Promise<DBSegmentMatch[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        const { statement, values } = buildSearchSegmentsQuery(query, limit);
        const res = await db.query(statement, values);
        return (res.values || []) as DBSegmentMatch[];
    }

    /** Raw access for small single-table helpers (voice profiles, meeting voices). */
    public async query(statement: string, values: any[] = []): Promise<any[]> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');
        return (await db.query(statement, values)).values || [];
    }

    public async run(statement: string, values: any[] = []): Promise<void> {
        await this.initialize();
        await this.dbManager.serializedWrite('meeting', db => db.run(statement, values));
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
