import { describe, expect, it } from 'vitest';
import { planChunks } from '../src/services/meeting/postProcessing/chunkPlanner';

const opts = { maxChunkMs: 10_000, padMs: 200, maxGapMs: 3000 };

describe('planChunks', () => {
    it('packs nearby speech into one chunk and skips long silences', () => {
        const chunks = planChunks([
            { startMs: 1000, endMs: 3000 },
            { startMs: 4000, endMs: 6000 },
            { startMs: 30_000, endMs: 32_000 },
        ], 60_000, opts);

        expect(chunks).toEqual([
            { startMs: 800, endMs: 6200 },
            { startMs: 29_800, endMs: 32_200 },
        ]);
    });

    it('starts a new chunk when the next region would exceed the maximum', () => {
        const chunks = planChunks([
            { startMs: 0, endMs: 6000 },
            { startMs: 7000, endMs: 12_000 },
        ], 20_000, opts);

        expect(chunks).toEqual([
            { startMs: 0, endMs: 6200 },
            { startMs: 6800, endMs: 12_200 },
        ]);
        chunks.forEach(c => expect(c.endMs - c.startMs).toBeLessThanOrEqual(10_000));
    });

    it('splits a region longer than the maximum into equal parts', () => {
        const chunks = planChunks([{ startMs: 200, endMs: 24_800 }], 30_000, opts);

        expect(chunks).toHaveLength(3);
        expect(chunks[0].startMs).toBe(0);
        expect(chunks[2].endMs).toBe(25_000);
        chunks.forEach(c => expect(c.endMs - c.startMs).toBeLessThanOrEqual(10_000));
        for (let i = 1; i < chunks.length; i++) expect(chunks[i].startMs).toBe(chunks[i - 1].endMs);
    });

    it('never produces overlapping chunks, even when padding makes regions touch', () => {
        const chunks = planChunks([
            { startMs: 1000, endMs: 9500 },
            { startMs: 9700, endMs: 15_000 },
        ], 20_000, opts);

        for (let i = 1; i < chunks.length; i++) expect(chunks[i].startMs).toBeGreaterThanOrEqual(chunks[i - 1].endMs);
        expect(chunks[0].startMs).toBe(800);
        expect(chunks[chunks.length - 1].endMs).toBe(15_200);
    });

    it('does not pack across a long silence even if the chunk would fit', () => {
        const chunks = planChunks([
            { startMs: 0, endMs: 2000 },
            { startMs: 6000, endMs: 8000 },
        ], 10_000, opts);

        expect(chunks).toEqual([
            { startMs: 0, endMs: 2200 },
            { startMs: 5800, endMs: 8200 },
        ]);
    });

    it('clamps padding to the recording', () => {
        expect(planChunks([{ startMs: 0, endMs: 5000 }], 5100, opts)).toEqual([{ startMs: 0, endMs: 5100 }]);
    });

    it('transcribes nothing in a silent recording', () => {
        expect(planChunks([], 60_000, opts)).toEqual([]);
    });

    it('falls back to fixed chunks without voice activity information', () => {
        expect(planChunks(null, 25_000, opts)).toEqual([
            { startMs: 0, endMs: 10_000 },
            { startMs: 10_000, endMs: 20_000 },
            { startMs: 20_000, endMs: 25_000 },
        ]);
    });
});
