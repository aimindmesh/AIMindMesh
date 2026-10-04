import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { normalizeForSearch } from '../meeting/meetingSearch';
import { logger } from '../logger';

/** Columns added after the first release, created on the existing tables at start. */
const ADDED_COLUMNS: Record<string, Array<[string, string]>> = {
    meetings: [
        ['is_synced', 'INTEGER DEFAULT 0'],
        ['server_id', 'TEXT'],
        // Meeting notes (synced): title, bookmarks, AI analysis and questions
        ['title', 'TEXT'],
        ['bookmarks_json', 'TEXT'],
        ['analysis_json', 'TEXT'],
        ['questions_json', 'TEXT'],
        // Average voice of each speaker, for known-voice recognition (local only)
        ['voices_json', 'TEXT'],
    ],
    meeting_segments: [
        ['is_synced', 'INTEGER DEFAULT 0'],
        ['server_id', 'TEXT'],
        // Text lowercased without accents, for search (derived: never synced)
        ['search_text', 'TEXT'],
    ],
};

/** Segments indexed per statement batch when filling search_text for older transcripts. */
const BACKFILL_BATCH = 500;

/** Creates the meeting tables and brings older ones up to date. */
export async function createMeetingTables(
    db: SQLiteDBConnection,
    write: <T>(fn: (db: SQLiteDBConnection) => Promise<T>) => Promise<T>
): Promise<void> {
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

    // People whose voice the app recognizes across meetings (local only, never synced)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS voice_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            embedding_json TEXT NOT NULL,
            meetings INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL
        );
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_meeting_segments_meeting_id
        ON meeting_segments(meeting_id, sequence);
    `);

    for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
        const tableInfo = await db.query(`PRAGMA table_info(${table});`);
        const existing = tableInfo.values?.map((col: any) => col.name) || [];
        for (const [column, type] of columns) {
            if (!existing.includes(column)) {
                logger.log('info', `[MeetingDB] Adding ${column} column to ${table}`);
                await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
            }
        }
    }

    await backfillSearchText(db, write);
}

/** Fills search_text for segments saved before it existed (or pulled by an older sync). */
async function backfillSearchText(
    db: SQLiteDBConnection,
    write: <T>(fn: (db: SQLiteDBConnection) => Promise<T>) => Promise<T>
): Promise<void> {
    const res = await db.query('SELECT id, text FROM meeting_segments WHERE search_text IS NULL');
    const rows = res.values || [];
    for (let i = 0; i < rows.length; i += BACKFILL_BATCH) {
        const batch = rows.slice(i, i + BACKFILL_BATCH).map(row => ({
            statement: 'UPDATE meeting_segments SET search_text = ? WHERE id = ?',
            values: [normalizeForSearch(row.text ?? ''), row.id]
        }));
        await write(conn => conn.executeSet(batch, true));
    }
    if (rows.length > 0) logger.log('info', `[MeetingDB] Indexed ${rows.length} segments for search`);
}
