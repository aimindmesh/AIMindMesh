import { describe, expect, it } from 'vitest';
import { AhcStrategy } from '../src/services/speaker/clustering/AhcStrategy';
import { averageLinkage } from '../src/services/speaker/clustering/utils';
import { StoredEmbedding } from '../src/services/speaker/clustering/types';

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}

/** `perSpeaker` noisy unit vectors around `speakers` random centers, in random time order. */
function synthetic(speakers: number, perSpeaker: number, dim: number, noise: number, seed = 1): StoredEmbedding[] {
    const rand = rng(seed);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const centers = Array.from({ length: speakers }, () => Array.from({ length: dim }, gauss));
    const items: StoredEmbedding[] = [];
    for (let s = 0; s < speakers; s++) {
        for (let k = 0; k < perSpeaker; k++) {
            const v = centers[s].map(c => c + noise * gauss());
            const norm = Math.hypot(...v);
            items.push({ id: `s${s}_${k}`, embedding: v.map(x => x / norm), timestamp: rand() * 1e6, originalSpeakerId: s });
        }
    }
    return items;
}

/** The previous implementation: recomputes average linkage from scratch at every merge. */
function referenceAhc(embeddings: StoredEmbedding[], threshold: number, target?: number): number[][] {
    let clusters = embeddings.map((_, i) => [i]);
    while (clusters.length > 1) {
        if (target !== undefined && clusters.length <= target) break;
        let min = Infinity, mi = -1, mj = -1;
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const d = averageLinkage(clusters[i].map(k => embeddings[k].embedding), clusters[j].map(k => embeddings[k].embedding));
                if (d < min) { min = d; mi = i; mj = j; }
            }
        }
        if (target === undefined && min > threshold) break;
        const merged = [...clusters[mi], ...clusters[mj]];
        clusters.splice(mj, 1);
        clusters.splice(mi, 1);
        clusters.push(merged);
    }
    return clusters;
}

/** Partition as a canonical set of sorted id lists, independent of cluster numbering. */
const partition = (groups: string[][]) => groups.map(g => [...g].sort().join(',')).sort();

function partitionOf(result: Map<string, number>): string[] {
    const groups = new Map<number, string[]>();
    result.forEach((speaker, id) => groups.set(speaker, [...(groups.get(speaker) || []), id]));
    return partition([...groups.values()]);
}

describe('AhcStrategy', () => {
    it('finds the same clusters as the previous O(n^3) implementation', () => {
        for (const [speakers, noise, threshold] of [[3, 0.6, 0.5], [4, 1.2, 0.6], [2, 2.0, 0.7]] as const) {
            const items = synthetic(speakers, 12, 32, noise, speakers * 7);
            const fast = new AhcStrategy().cluster(items, { distanceThreshold: threshold });
            const ref = referenceAhc(items, threshold).map(c => c.map(i => items[i].id));
            expect(partitionOf(fast.speakerAssignments)).toEqual(partition(ref));
        }
    });

    it('stops at the requested number of speakers', () => {
        const items = synthetic(3, 10, 32, 0.6);
        const result = new AhcStrategy().cluster(items, { targetSpeakers: 3 });
        expect(result.speakerCount).toBe(3);
        expect(partitionOf(result.speakerAssignments)).toEqual(
            partition([0, 1, 2].map(s => items.filter(i => i.originalSpeakerId === s).map(i => i.id))));
    });

    it('numbers speakers by who talks first', () => {
        const items = synthetic(3, 5, 16, 0.3);
        const result = new AhcStrategy().cluster(items, { distanceThreshold: 0.5 });
        const first = [...items].sort((a, b) => a.timestamp - b.timestamp)[0];
        expect(result.speakerAssignments.get(first.id)).toBe(0);
    });

    it('clusters a one-hour meeting worth of segments quickly', () => {
        const items = synthetic(5, 100, 192, 0.5); // same-speaker cosine ~0.8, as real embeddings
        const start = performance.now();
        const result = new AhcStrategy().cluster(items, { distanceThreshold: 0.5 });
        expect(performance.now() - start).toBeLessThan(3000);
        expect(result.speakerCount).toBe(5);
    });
});
