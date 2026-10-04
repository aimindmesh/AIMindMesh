import { describe, expect, it } from 'vitest';
import { assignSpeakers, SpeakerItem } from '../src/services/meeting/postProcessing/speakerAssignment';

/** Unit vector near axis `axis` (speaker identity) with a small per-item wobble. */
function voice(axis: number, wobble: number): number[] {
    const v = new Array(8).fill(0);
    v[axis] = 1;
    v[(axis + 1) % 8] = wobble;
    const n = Math.hypot(...v);
    return v.map(x => x / n);
}

const item = (id: string, startMs: number, endMs: number, embedding: number[] | null): SpeakerItem =>
    ({ id, startMs, endMs, embedding });

describe('assignSpeakers', () => {
    it('groups items by voice and numbers speakers by who talks first', () => {
        const items = [
            item('a', 0, 3000, voice(2, 0.1)),
            item('b', 3000, 6000, voice(5, 0.2)),
            item('c', 6000, 9000, voice(2, 0.3)),
            item('d', 9000, 12_000, voice(5, 0.0)),
        ];
        const speakers = assignSpeakers(items, { distanceThreshold: 0.5 });
        expect(['a', 'b', 'c', 'd'].map(id => speakers.get(id))).toEqual([0, 1, 0, 1]);
    });

    it('gives an item without embedding the speaker nearest in time', () => {
        const items = [
            item('a', 0, 3000, voice(1, 0)),
            item('short', 3100, 3500, null),
            item('b', 10_000, 13_000, voice(4, 0)),
            item('late-short', 13_100, 13_400, null),
        ];
        const speakers = assignSpeakers(items, { distanceThreshold: 0.5 });
        expect(speakers.get('short')).toBe(speakers.get('a'));
        expect(speakers.get('late-short')).toBe(speakers.get('b'));
    });

    it('honors a known number of speakers', () => {
        const items = [0, 1, 2, 3].map(k => item(`i${k}`, k * 1000, k * 1000 + 900, voice(k, 0)));
        const speakers = assignSpeakers(items, { distanceThreshold: 0.1, targetSpeakers: 2 });
        expect(new Set(speakers.values()).size).toBe(2);
    });

    it('folds a speaker heard only briefly into the closest voice', () => {
        const items = [
            item('a1', 0, 3000, voice(1, 0)),
            item('a2', 3000, 6000, voice(1, 0.1)),
            item('noisy', 6000, 7500, voice(1, 0.9)),   // same person, distorted: own cluster
            item('b1', 8000, 11_000, voice(5, 0)),
            item('b2', 11_000, 14_000, voice(5, 0.1)),
        ];
        const without = assignSpeakers(items, { distanceThreshold: 0.2 });
        expect(new Set(without.values()).size).toBe(3);

        const speakers = assignSpeakers(items, { distanceThreshold: 0.2, minSpeakerMs: 4000 });
        expect(new Set(speakers.values()).size).toBe(2);
        expect(speakers.get('noisy')).toBe(speakers.get('a1'));
    });

    it('puts everyone on one speaker when no item has a voice embedding', () => {
        const speakers = assignSpeakers([item('a', 0, 400, null), item('b', 500, 900, null)], { distanceThreshold: 0.5 });
        expect([...speakers.values()]).toEqual([0, 0]);
    });
});
