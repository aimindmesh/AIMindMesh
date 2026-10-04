import { describe, expect, it } from 'vitest';
import { anchorBookmarks, bookmarkPlaybackStart, findActiveSegment } from '../src/services/meeting/transcriptTimeline';
import { TranscriptSegment } from '../src/types/meeting';

const seg = (id: string, start: number, end: number): TranscriptSegment =>
    ({ id, speakerId: 0, text: id, timestamp: 0, start_ms: start, end_ms: end });

const transcript = [seg('a', 1_000, 4_000), seg('b', 5_000, 9_000), seg('c', 20_000, 25_000)];

describe('findActiveSegment', () => {
    it('finds the segment being heard', () => {
        expect(findActiveSegment(transcript, 0)).toBe(-1);
        expect(findActiveSegment(transcript, 2_000)).toBe(0);
        expect(findActiveSegment(transcript, 5_000)).toBe(1);
        expect(findActiveSegment(transcript, 24_000)).toBe(2);
    });

    it('keeps a segment through a short pause, not a long silence', () => {
        expect(findActiveSegment(transcript, 4_500)).toBe(0);
        expect(findActiveSegment(transcript, 15_000)).toBe(-1);
    });

    it('ignores segments without times', () => {
        const mixed = [seg('a', 1_000, 4_000), { ...seg('x', 0, 0), start_ms: undefined, end_ms: undefined }, seg('b', 5_000, 9_000)];
        expect(findActiveSegment(mixed, 6_000)).toBe(2);
    });
});

describe('anchorBookmarks', () => {
    it('puts each bookmark on what was being said when it was marked', () => {
        const anchors = anchorBookmarks(transcript, [
            { id: '2', ms: 21_000 },
            { id: '1', ms: 6_000 },
            { id: '0', ms: 500 },
            { id: 'late', ms: 60_000 },
        ]);
        expect(anchors.get(0)?.map(b => b.id)).toEqual(['0']);
        expect(anchors.get(1)?.map(b => b.id)).toEqual(['1']);
        expect(anchors.get(2)?.map(b => b.id)).toEqual(['2']);
        expect(anchors.get(-1)?.map(b => b.id)).toEqual(['late']);
    });

    it('shows bookmarks at the end of a transcript without times', () => {
        const untimed = transcript.map(t => ({ ...t, start_ms: undefined, end_ms: undefined }));
        expect(anchorBookmarks(untimed, [{ id: 'b', ms: 5_000 }]).get(-1)?.length).toBe(1);
    });
});

describe('bookmarkPlaybackStart', () => {
    it('plays from the start of the sentence, at most 30 s back', () => {
        expect(bookmarkPlaybackStart(transcript, { id: 'b', ms: 7_000 })).toBe(5_000);
        expect(bookmarkPlaybackStart([seg('long', 0, 120_000)], { id: 'b', ms: 100_000 })).toBe(70_000);
        expect(bookmarkPlaybackStart([], { id: 'b', ms: 7_000 })).toBe(7_000);
    });
});
