/**
 * Meeting notes (title, bookmarks, AI analysis, questions): how they are stored and shown.
 */

import { Bookmark, EMPTY_NOTES, MeetingAnalysis, MeetingNotes, MeetingQuestion } from '../../types/meeting';
import type { DBMeeting } from '../database/meetingDatabase';

/** Two marks closer than this are the same moment (e.g. the same tap seen natively and in the UI). */
const SAME_BOOKMARK_MS = 1500;

function parseJson<T>(json: string | null | undefined, fallback: T): T {
    if (!json) return fallback;
    try {
        return JSON.parse(json) ?? fallback;
    } catch {
        return fallback;
    }
}

export function notesFromRow(row: Pick<DBMeeting, 'title' | 'bookmarks_json' | 'analysis_json' | 'questions_json'>): MeetingNotes {
    const bookmarks = parseJson<Bookmark[]>(row.bookmarks_json, []);
    const questions = parseJson<MeetingQuestion[]>(row.questions_json, []);
    return {
        title: row.title || '',
        bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
        analysis: parseJson<MeetingAnalysis | null>(row.analysis_json, null),
        questions: Array.isArray(questions) ? questions : []
    };
}

export function notesToRow(notes: Partial<MeetingNotes>): Partial<Pick<DBMeeting, 'title' | 'bookmarks_json' | 'analysis_json' | 'questions_json'>> {
    const row: Partial<Pick<DBMeeting, 'title' | 'bookmarks_json' | 'analysis_json' | 'questions_json'>> = {};
    if (notes.title !== undefined) row.title = notes.title.trim() || null;
    if (notes.bookmarks !== undefined) row.bookmarks_json = notes.bookmarks.length ? JSON.stringify(notes.bookmarks) : null;
    if (notes.analysis !== undefined) row.analysis_json = notes.analysis ? JSON.stringify(notes.analysis) : null;
    if (notes.questions !== undefined) row.questions_json = notes.questions.length ? JSON.stringify(notes.questions) : null;
    return row;
}

export function hasNotes(notes: MeetingNotes): boolean {
    return !!notes.title || notes.bookmarks.length > 0 || !!notes.analysis || notes.questions.length > 0;
}

/** Union of two bookmark lists, sorted by time, keeping the first of marks that are the same moment. */
export function mergeBookmarks(current: Bookmark[], added: Bookmark[]): Bookmark[] {
    const merged = [...current];
    for (const b of added) {
        if (!merged.some(m => Math.abs(m.ms - b.ms) < SAME_BOOKMARK_MS)) {
            merged.push(b);
        }
    }
    return merged.sort((a, b) => a.ms - b.ms);
}

/** Bookmarks the native recorder reports as positions (ms) in the recording. */
export function bookmarksFromPositions(positions: number[] | undefined): Bookmark[] {
    return (positions ?? []).map(ms => ({ id: `bm_${Math.round(ms)}`, ms: Math.round(ms) }));
}

export function formatMeetingDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/** The user's title, else the AI's, else the date. */
export function displayTitle(meeting: { timestamp: number } & Pick<MeetingNotes, 'title' | 'analysis'>): string {
    return meeting.title || meeting.analysis?.title || `Meeting of ${formatMeetingDate(meeting.timestamp)}`;
}

export { EMPTY_NOTES };
