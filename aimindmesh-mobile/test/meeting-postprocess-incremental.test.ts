import { describe, expect, it } from 'vitest';
import { appendSpeech, readyChunks, spansSpeakerChange, turnsWithin } from '../src/services/meeting/postProcessing/incrementalPlan';

describe('appendSpeech', () => {
    it('adds new regions and drops those a rescan found again', () => {
        const known = [{ startMs: 0, endMs: 2000 }, { startMs: 3000, endMs: 5000 }];
        expect(appendSpeech(known, [{ startMs: 4800, endMs: 5000 }, { startMs: 7000, endMs: 9000 }]))
            .toEqual([...known, { startMs: 7000, endMs: 9000 }]);
    });
});

describe('readyChunks', () => {
    const speech = [
        { startMs: 1000, endMs: 4000 },
        { startMs: 4200, endMs: 8000 },   // after a 0.2 s pause: same chunk
        { startMs: 9000, endMs: 12_000 }, // after a 1 s pause (a change of speaker?): new chunk
    ];

    it('cuts at pauses and waits until no later speech can join a chunk', () => {
        // Speech up to 12 s, scanned up to 12.1 s: the last chunk could still grow
        const { chunks, nextFromMs } = readyChunks(speech, 0, 12_100, false);
        expect(chunks).toEqual([{ startMs: 850, endMs: 8150 }]);
        expect(nextFromMs).toBe(8150);
    });

    it('releases everything once the recording is over', () => {
        const { chunks } = readyChunks(speech, 8150, 12_100, true);
        expect(chunks).toEqual([{ startMs: 8850, endMs: 12_100 }]);
    });

    it('never goes back before what was already transcribed', () => {
        const { chunks } = readyChunks([{ startMs: 8100, endMs: 9000 }], 8150, 20_000, false);
        expect(chunks[0].startMs).toBe(8150);
    });

    it('keeps long monologues in chunks of at most 20 s', () => {
        const { chunks } = readyChunks([{ startMs: 0, endMs: 50_000 }], 0, 60_000, false);
        expect(chunks.length).toBe(3);
        expect(Math.max(...chunks.map(c => c.endMs - c.startMs))).toBeLessThanOrEqual(20_000);
    });
});

describe('speaker changes inside a sentence', () => {
    const labelled = [
        { startMs: 0, endMs: 5000, speaker: 0 },
        { startMs: 5200, endMs: 9000, speaker: 1 },
        { startMs: 9100, endMs: 9600, speaker: 0 },
    ];

    it('flags a sentence where a second voice talks for more than a moment', () => {
        expect(spansSpeakerChange({ startMs: 0, endMs: 9000 }, labelled)).toBe(true);
        expect(spansSpeakerChange({ startMs: 0, endMs: 5000 }, labelled)).toBe(false);
        // Half a second of someone else (a "sì") is not a change
        expect(spansSpeakerChange({ startMs: 5200, endMs: 9600 }, labelled)).toBe(false);
    });

    it('splits a mixed range into one range per speaker turn', () => {
        const turns = turnsWithin({ startMs: 0, endMs: 9000 }, labelled);
        expect(turns.map(t => t.speaker)).toEqual([0, 1]);
        expect(turns[0].startMs).toBe(0);
        expect(turns[1].endMs).toBe(9000);
        expect(turns[0].endMs).toBeLessThanOrEqual(turns[1].startMs);
    });
});
