/**
 * Where things are in a transcript's timeline: the segment being played, where a bookmark goes.
 */

import { Bookmark, TranscriptSegment } from '../../types/meeting';

/** A segment stays highlighted this long after it ends, through the pause before the next one. */
const TRAILING_MS = 1500;

/**
 * Index of the last segment starting at or before `ms`, or -1 when none has started yet.
 * Segments are in recording order; ones without a start time are skipped.
 */
export function segmentIndexAt(transcript: TranscriptSegment[], ms: number): number {
    let found = -1;
    for (let i = 0; i < transcript.length; i++) {
        const start = transcript[i].start_ms;
        if (start === undefined) continue;
        if (start <= ms) found = i;
        else if (found >= 0) break;
    }
    return found;
}

/** Index of the segment being heard at `ms` (or just heard, during a short pause), else -1. */
export function findActiveSegment(transcript: TranscriptSegment[], ms: number): number {
    const i = segmentIndexAt(transcript, ms);
    if (i < 0) return -1;
    const end = transcript[i].end_ms ?? transcript[i].start_ms!;
    return ms <= end + TRAILING_MS ? i : -1;
}

/**
 * The segment each bookmark belongs to: the one being said when the moment was marked (people
 * mark right after hearing something), or the first one when it was marked before any speech.
 * Bookmarks of a transcript without times, or past its end, map to -1 (shown at the end).
 */
export function anchorBookmarks(transcript: TranscriptSegment[], bookmarks: Bookmark[]): Map<number, Bookmark[]> {
    const anchors = new Map<number, Bookmark[]>();
    const timed = transcript.some(t => t.start_ms !== undefined);
    const lastEnd = timed ? Math.max(...transcript.map(t => t.end_ms ?? t.start_ms ?? 0)) : 0;
    for (const bookmark of [...bookmarks].sort((a, b) => a.ms - b.ms)) {
        let index = -1;
        if (timed && bookmark.ms <= lastEnd + TRAILING_MS) {
            index = segmentIndexAt(transcript, bookmark.ms);
            if (index < 0) index = transcript.findIndex(t => t.start_ms !== undefined);
        }
        anchors.set(index, [...(anchors.get(index) ?? []), bookmark]);
    }
    return anchors;
}

/** Where to start playing a bookmark from: the beginning of what was being said. */
export function bookmarkPlaybackStart(transcript: TranscriptSegment[], bookmark: Bookmark): number {
    const i = segmentIndexAt(transcript, bookmark.ms);
    const start = i >= 0 ? transcript[i].start_ms! : bookmark.ms;
    // A long monologue: don't go back more than half a minute
    return Math.max(start, bookmark.ms - 30_000, 0);
}
