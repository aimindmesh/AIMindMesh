import { describe, expect, it } from 'vitest';
import { buildSpeakerChunks, labelSpeech } from '../src/services/meeting/postProcessing/speakerChunks';

const opts = { maxChunkMs: 10_000, padMs: 200, maxGapMs: 3000 };

describe('buildSpeakerChunks', () => {
    it('never puts two speakers in one chunk', () => {
        const chunks = buildSpeakerChunks([
            { startMs: 0, endMs: 3000, speaker: 0 },
            { startMs: 3000, endMs: 6000, speaker: 0 },
            { startMs: 6500, endMs: 9000, speaker: 1 },
            { startMs: 9200, endMs: 11_000, speaker: 0 },
        ], 20_000, opts);

        expect(chunks.map(c => c.speaker)).toEqual([0, 1, 0]);
        expect(chunks[0]).toEqual({ startMs: 0, endMs: 6200, speaker: 0 });
        for (let i = 1; i < chunks.length; i++) expect(chunks[i].startMs).toBeGreaterThanOrEqual(chunks[i - 1].endMs);
    });

    it('joins one speaker across short pauses but not long silences', () => {
        const chunks = buildSpeakerChunks([
            { startMs: 0, endMs: 2000, speaker: 0 },
            { startMs: 3000, endMs: 5000, speaker: 0 },
            { startMs: 15_000, endMs: 17_000, speaker: 0 },
        ], 20_000, opts);

        expect(chunks).toEqual([
            { startMs: 0, endMs: 5200, speaker: 0 },
            { startMs: 14_800, endMs: 17_200, speaker: 0 },
        ]);
    });

    it('splits a long monologue into chunks of at most the maximum', () => {
        const chunks = buildSpeakerChunks([{ startMs: 0, endMs: 25_000, speaker: 2 }], 30_000, opts);
        expect(chunks).toHaveLength(3);
        chunks.forEach(c => {
            expect(c.speaker).toBe(2);
            expect(c.endMs - c.startMs).toBeLessThanOrEqual(10_000);
        });
    });
});

describe('labelSpeech', () => {
    it('gives a short utterance the speaker of the nearest window', () => {
        const pieces = labelSpeech(
            [{ startMs: 0, endMs: 3000, speaker: 0 }, { startMs: 10_000, endMs: 13_000, speaker: 1 }],
            [{ startMs: 13_500, endMs: 14_000 }]
        );
        expect(pieces[pieces.length - 1]).toEqual({ startMs: 13_500, endMs: 14_000, speaker: 1 });
    });

    it('keeps short utterances when no window could be embedded', () => {
        expect(labelSpeech([], [{ startMs: 0, endMs: 500 }])).toEqual([{ startMs: 0, endMs: 500, speaker: 0 }]);
    });
});
