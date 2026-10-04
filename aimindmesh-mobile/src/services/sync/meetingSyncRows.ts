/**
 * Meeting rows exchanged with the AIMindMesh server. Columns are listed explicitly: local-only
 * data (speakers' voices, the search index) never leaves the phone.
 */

import type { SyncMeeting, SyncMeetingSegment } from '@aimindmesh/api-types';
import { normalizeForSearch } from '../meeting/meetingSearch';
import { NOTES_COLUMNS } from '../database/meetingStatements';

const MEETING_PUSH_COLUMNS = [
    'id', 'timestamp', 'duration', 'has_audio', 'audio_file_path', 'audio_mime_type', 'speaker_names_json',
    ...NOTES_COLUMNS
];
const SEGMENT_PUSH_COLUMNS = [
    'id', 'meeting_id', 'sequence', 'start_ms', 'end_ms', 'text', 'speaker_id', 'stt_provider', 'confidence',
    'words_json', 'original_text', 'is_edited', 'edited_at'
];

export const PUSH_MEETINGS_QUERY = `SELECT ${MEETING_PUSH_COLUMNS.join(', ')} FROM meetings WHERE is_synced = 0`;
export const PUSH_SEGMENTS_QUERY = `SELECT ${SEGMENT_PUSH_COLUMNS.join(', ')} FROM meeting_segments WHERE is_synced = 0`;

/**
 * Upsert of a pulled meeting. Rows with local changes not pushed yet (is_synced = 0) are left as
 * they are; notes are written only when the server sent them (an older server has no notes).
 */
export function pulledMeetingStatement(m: SyncMeeting): { statement: string; values: unknown[] } {
    const sent = (column: typeof NOTES_COLUMNS[number]) => (column in m ? 1 : 0);
    return {
        statement: `INSERT INTO meetings (id, timestamp, duration, has_audio, speaker_names_json, is_synced, server_id,
                ${NOTES_COLUMNS.join(', ')})
            VALUES (?, ?, ?, ?, ?, 1, ?, ${NOTES_COLUMNS.map(() => '?').join(', ')})
            ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, duration = excluded.duration,
                has_audio = excluded.has_audio, speaker_names_json = excluded.speaker_names_json, server_id = excluded.server_id,
                ${NOTES_COLUMNS.map(c => `${c} = CASE WHEN ? THEN excluded.${c} ELSE meetings.${c} END`).join(',\n                ')}
            WHERE meetings.is_synced = 1`,
        values: [
            m.id, m.timestamp, m.duration, m.has_audio ? 1 : 0, m.speaker_names_json ?? null, m.id,
            ...NOTES_COLUMNS.map(c => m[c] ?? null),
            ...NOTES_COLUMNS.map(sent)
        ]
    };
}

/** Upsert of a pulled segment, with its search index computed here (it is never synced). */
export function pulledSegmentStatement(s: SyncMeetingSegment): { statement: string; values: unknown[] } {
    return {
        statement: `INSERT INTO meeting_segments (id, meeting_id, sequence, start_ms, end_ms, text, speaker_id, original_text, is_edited, edited_at, search_text, is_synced, server_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, start_ms = excluded.start_ms, end_ms = excluded.end_ms,
                text = excluded.text, speaker_id = excluded.speaker_id, original_text = excluded.original_text,
                is_edited = excluded.is_edited, edited_at = excluded.edited_at, search_text = excluded.search_text,
                server_id = excluded.server_id
            WHERE meeting_segments.is_synced = 1`,
        values: [
            s.id, s.meeting_id, s.sequence, s.start_ms, s.end_ms, s.text, s.speaker_id ?? null,
            s.original_text ?? null, s.is_edited ? 1 : 0, s.edited_at ?? null, normalizeForSearch(s.text ?? ''), s.id
        ]
    };
}
