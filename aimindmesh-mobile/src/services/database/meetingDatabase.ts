import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { DatabaseManager } from './DatabaseManager';
import { logger } from '../logger';


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
        const db = await this.dbManager.getDatabase('meeting');

        try {
            const hasAudioInt = meeting.has_audio ? 1 : 0;
            const speakerNamesJson = meeting.speaker_names_json || '{}';

            // Insert or replace meeting
            await db.run(
                `INSERT OR REPLACE INTO meetings 
                (id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    meeting.id,
                    meeting.timestamp,
                    meeting.duration,
                    hasAudioInt,
                    meeting.audio_file_path,
                    meeting.audio_mime_type,
                    speakerNamesJson
                ]
            );

            // Delete existing segments for this meeting to replace them
            await db.run('DELETE FROM meeting_segments WHERE meeting_id = ?', [meeting.id]);

            // Prepare batch statement for segments
            const statements = segments.map(seg => ({
                statement: `INSERT INTO meeting_segments 
                    (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, stt_provider, confidence, words_json, original_text, is_edited, edited_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                values: [
                    seg.id,
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
            }));

            if (statements.length > 0) {
                await db.executeSet(statements);
            }

            logger.log('info', `Saved meeting ${meeting.id} with ${segments.length} segments to SQLite`);
        } catch (error) {
            logger.log('error', 'Failed to save meeting to DB', error);
            throw error;
        }
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

    public async deleteMeeting(id: string): Promise<void> {
        await this.initialize();
        const db = await this.dbManager.getDatabase('meeting');

        try {
            // Note: segments are deleted automatically due to ON DELETE CASCADE
            await db.run('DELETE FROM meetings WHERE id = ?', [id]);
            logger.log('info', `Deleted meeting ${id} from DB`);
        } catch (error) {
            logger.log('error', `Failed to delete meeting ${id}`, error);
            throw error;
        }
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
                     SET text = ?, is_edited = 1, edited_at = ?, original_text = ?
                     WHERE id = ?`,
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
