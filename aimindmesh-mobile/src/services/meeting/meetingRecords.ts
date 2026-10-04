/**
 * Single-meeting reads and partial updates: History list and search, notes, and results that
 * arrive for a meeting that is not on screen (post-processing, AI notes after the user moved on).
 */

import { logger } from '../logger';
import { Bookmark, MeetingNotes, MeetingSummary, SavedMeeting, TranscriptSegment } from '../../types/meeting';
import { MeetingDatabase } from '../database/meetingDatabase';
import { getAudioPath, mapDBMeetingToSavedMeeting, migrateLegacyMeetings, saveMeeting } from './meetingStorage';
import { mergeBookmarks, notesFromRow, notesToRow } from './meetingNotes';

/** A stored meeting with its transcript and notes, or null when it doesn't exist (anymore). */
export async function loadMeeting(meetingId: string): Promise<SavedMeeting | null> {
    const mdb = MeetingDatabase.getInstance();
    const dbMeeting = await mdb.getMeetingById(meetingId);
    if (!dbMeeting) return null;
    return mapDBMeetingToSavedMeeting(dbMeeting, await mdb.getMeetingSegments(meetingId));
}

/**
 * Marks a meeting as having the audio that the recorder just finalized (or recovered after a
 * crash), keeping whatever transcript was already saved; creates the meeting if needed. The
 * moments marked during the recording are added to the saved ones.
 */
export async function attachRecordingToMeeting(recording: {
    meetingId: string;
    startedAt: number;
    durationMs: number;
    mimeType: string;
    bookmarks?: Bookmark[];
}): Promise<SavedMeeting | null> {
    const mdb = MeetingDatabase.getInstance();
    await mdb.attachRecoveredAudio({
        id: recording.meetingId,
        timestamp: recording.startedAt,
        durationSec: recording.durationMs / 1000,
        audioPath: getAudioPath(recording.meetingId),
        mimeType: recording.mimeType
    });
    const meeting = await loadMeeting(recording.meetingId);
    if (meeting && recording.bookmarks?.length) {
        meeting.bookmarks = mergeBookmarks(meeting.bookmarks ?? [], recording.bookmarks);
        await mdb.updateNotes(meeting.id, notesToRow({ bookmarks: meeting.bookmarks }));
    }
    return meeting;
}

/** Saves part of a meeting's notes (e.g. an analysis finished after the user moved on). */
export async function updateMeetingNotes(meetingId: string, notes: Partial<MeetingNotes>): Promise<void> {
    await MeetingDatabase.getInstance().updateNotes(meetingId, notesToRow(notes));
}

export async function loadMeetingNotes(meetingId: string): Promise<MeetingNotes | null> {
    const row = await MeetingDatabase.getInstance().getMeetingById(meetingId);
    return row ? notesFromRow(row) : null;
}

/**
 * Replaces the transcript of a stored meeting (a result for a meeting that is not on screen),
 * keeping its audio and notes. Nothing happens if the meeting was deleted meanwhile.
 */
export async function replaceMeetingTranscript(
    meetingId: string,
    transcript: TranscriptSegment[],
    speakerNames?: Record<number, string>
): Promise<void> {
    const meeting = await loadMeeting(meetingId);
    if (!meeting) return;
    await saveMeeting({
        id: meeting.id,
        timestamp: meeting.timestamp,
        duration: meeting.duration,
        transcript,
        speakerNames: speakerNames ?? meeting.speakerNames,
        hasAudio: meeting.hasAudio,
        audioMimeType: meeting.audioMimeType
    });
}

/** Gives segments of a stored meeting new speakers (by segment id), with optional names. */
export async function updateMeetingSpeakers(
    meetingId: string,
    speakers: Map<string, number>,
    speakerNames?: Record<number, string>
): Promise<void> {
    const meeting = await loadMeeting(meetingId);
    if (!meeting) return;
    await replaceMeetingTranscript(
        meetingId,
        meeting.transcript.map(t => ({ ...t, speakerId: speakers.get(t.id) ?? t.speakerId })),
        speakerNames ?? meeting.speakerNames
    );
}

/** Every meeting, newest first, without transcripts (History). */
export async function listMeetings(): Promise<MeetingSummary[]> {
    const mdb = MeetingDatabase.getInstance();
    let rows = await mdb.listMeetings();
    try {
        if ((await migrateLegacyMeetings(new Set(rows.map(r => r.id)))).length > 0) {
            rows = await mdb.listMeetings();
        }
    } catch (lsError) {
        logger.log('error', 'Error migrating legacy localStorage meetings', lsError);
    }
    return rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        duration: row.duration,
        hasAudio: row.has_audio,
        segmentCount: row.segment_count,
        speakerCount: row.speaker_count,
        preview: row.first_text ?? '',
        ...notesFromRow(row)
    }));
}

export interface SegmentMatch {
    segmentId: string;
    startMs: number;
    text: string;
}

/** Transcript passages containing `query` (case and accent insensitive), grouped by meeting id. */
export async function searchTranscripts(query: string): Promise<Map<string, SegmentMatch[]>> {
    const byMeeting = new Map<string, SegmentMatch[]>();
    const trimmed = query.trim();
    if (!trimmed) return byMeeting;
    for (const row of await MeetingDatabase.getInstance().searchSegments(trimmed)) {
        const list = byMeeting.get(row.meeting_id) ?? [];
        list.push({ segmentId: row.id, startMs: row.start_ms, text: row.text });
        byMeeting.set(row.meeting_id, list);
    }
    return byMeeting;
}
