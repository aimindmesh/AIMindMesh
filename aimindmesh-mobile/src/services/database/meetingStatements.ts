import type { capSQLiteSet } from '@capacitor-community/sqlite';
import { normalizeForSearch } from '../meeting/meetingSearch';

/** The notes columns of a meetings row (synced with the server). */
export const NOTES_COLUMNS = ['title', 'bookmarks_json', 'analysis_json', 'questions_json'] as const;
export type NotesColumn = typeof NOTES_COLUMNS[number];
export type MeetingNotesColumns = Partial<Record<NotesColumn, string | null>>;

/** One SQL statement and its values (a capSQLiteSet entry with both set). */
export interface Statement {
    statement: string;
    values: any[];
}

export interface DBMeeting extends MeetingNotesColumns {
    id: string;
    timestamp: number;
    duration: number;
    has_audio: boolean;
    audio_file_path: string | null;
    audio_mime_type: string | null;
    speaker_names_json: string; // JSON string record of idx -> name
    /** Average voice of each speaker (known-voice recognition): never leaves the phone. */
    voices_json?: string | null;
}

/** A meetings row with counts of its segments, for lists that don't load transcripts. */
export interface DBMeetingListRow extends DBMeeting {
    segment_count: number;
    speaker_count: number;
    /** Text of the first segment, as a preview. */
    first_text: string | null;
}

/** A transcript segment matching a search. */
export interface DBSegmentMatch {
    meeting_id: string;
    id: string;
    start_ms: number;
    text: string;
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
 * Updates the notes columns given (undefined = left as is) of an existing meeting; is_synced = 0
 * pushes the change.
 */
export function buildUpdateNotesStatement(meetingId: string, notes: MeetingNotesColumns): Statement | null {
    const columns = NOTES_COLUMNS.filter(column => notes[column] !== undefined);
    if (columns.length === 0) return null;
    return {
        statement: `UPDATE meetings SET ${columns.map(c => `${c} = ?`).join(', ')}, is_synced = 0 WHERE id = ?`,
        values: [...columns.map(c => notes[c] ?? null), meetingId]
    };
}

/**
 * Statements of one meeting save, run as a single transaction. The meeting row is upserted (not
 * REPLACEd: that deletes the row, cascading to the segments and dropping server_id). Audio fields
 * only grow, so a save without new audio keeps the stored file; is_synced = 0 pushes the change.
 * Notes columns are written only when the meeting carries them, so saves that know nothing of
 * the notes (recovery, reprocessing) never erase them.
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
        }
    ];
    const notes = buildUpdateNotesStatement(meeting.id, meeting);
    if (notes) set.push(notes);

    // Every stored segment is tombstoned, then the ones written again lose their tombstone
    // (below): what remains are the segments this save dropped, to be deleted remotely too.
    set.push(
        {
            statement: `INSERT OR REPLACE INTO sync_deletions (entity_type, entity_id, deleted_at)
                SELECT 'segment', id, ? FROM meeting_segments WHERE meeting_id = ?`,
            values: [deletedAt, meeting.id]
        },
        { statement: 'DELETE FROM meeting_segments WHERE meeting_id = ?', values: [meeting.id] }
    );

    // A duplicated id inside one transcript would abort the whole transaction
    const seen = new Set<string>();
    for (const seg of segments) {
        let id = seg.id;
        if (seen.has(id)) id = `${id}_${seg.sequence}`;
        seen.add(id);
        set.push({
            statement: `INSERT INTO meeting_segments
                (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, stt_provider, confidence, words_json, original_text, is_edited, edited_at, search_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                seg.edited_at,
                normalizeForSearch(seg.text)
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

/**
 * Records that a meeting now has its audio file (a finished or recovered recording), creating
 * the meeting if needed, without touching its transcript or notes.
 */
export function buildMarkMeetingAudioStatement(audio: {
    meetingId: string;
    startedAt: number;
    durationSec: number;
    audioFilePath: string;
    mimeType: string;
}): Statement {
    return {
        statement: `INSERT INTO meetings (id, timestamp, duration, has_audio, audio_file_path, audio_mime_type, speaker_names_json, is_synced)
            VALUES (?, ?, ?, 1, ?, ?, '{}', 0)
            ON CONFLICT(id) DO UPDATE SET
                duration = MAX(meetings.duration, excluded.duration),
                has_audio = 1,
                audio_file_path = excluded.audio_file_path,
                audio_mime_type = excluded.audio_mime_type,
                is_synced = 0`,
        values: [audio.meetingId, audio.startedAt, audio.durationSec, audio.audioFilePath, audio.mimeType]
    };
}

/** Stores the speakers' voices of a meeting: local data, so the row is not marked for sync. */
export function buildUpdateVoicesStatement(meetingId: string, voicesJson: string | null): Statement {
    return { statement: 'UPDATE meetings SET voices_json = ? WHERE id = ?', values: [voicesJson, meetingId] };
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

/** All meetings, newest first, with segment and speaker counts and the first sentence. */
export const LIST_MEETINGS_QUERY = `SELECT m.*,
        (SELECT COUNT(*) FROM meeting_segments s WHERE s.meeting_id = m.id) AS segment_count,
        (SELECT COUNT(DISTINCT s.speaker_id) FROM meeting_segments s WHERE s.meeting_id = m.id) AS speaker_count,
        (SELECT s.text FROM meeting_segments s WHERE s.meeting_id = m.id ORDER BY s.sequence LIMIT 1) AS first_text
    FROM meetings m
    ORDER BY m.timestamp DESC`;

/** Escapes LIKE wildcards so a search for "50%" matches the text "50%". */
export function likePattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/**
 * Transcript segments containing `query`, ignoring case and accents, newest meetings first.
 * Matches on search_text, the segment text lowercased without accents (see normalizeForSearch).
 */
export function buildSearchSegmentsQuery(query: string, limit = 300): Statement {
    return {
        statement: `SELECT s.meeting_id, s.id, s.start_ms, s.text
            FROM meeting_segments s JOIN meetings m ON m.id = s.meeting_id
            WHERE s.search_text LIKE ? ESCAPE '\\'
            ORDER BY m.timestamp DESC, s.sequence ASC
            LIMIT ?`,
        values: [likePattern(normalizeForSearch(query.trim())), limit]
    };
}
