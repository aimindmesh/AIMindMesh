import { describe, expect, it } from 'vitest';
import { learnVoice, normalize, recognizeVoices, voiceCentroids, VoiceProfile } from '../src/services/speaker/voiceProfiles';

const profile = (id: string, name: string, embedding: number[], meetings = 1): VoiceProfile =>
    ({ id, name, embedding: normalize(embedding), meetings, updatedAt: 0 });

const marco = profile('m', 'Marco', [1, 0, 0]);
const anna = profile('a', 'Anna', [0, 1, 0]);

describe('voiceCentroids', () => {
    it('averages each speaker\'s windows, longer windows counting more', () => {
        const windows = [{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 4000 }, { startMs: 5000, endMs: 8000 }];
        const centroids = voiceCentroids(windows, [[1, 0], [0, 1], null], i => [0, 0, 1][i]);
        const v = centroids.get(0)!;
        expect(v[0]).toBeCloseTo(3 / Math.sqrt(10), 3);
        expect(v[1]).toBeCloseTo(1 / Math.sqrt(10), 3);
        expect(centroids.has(1)).toBe(false); // its only window had no embedding
    });
});

describe('recognizeVoices', () => {
    it('names the speakers whose voice matches a known one', () => {
        const named = recognizeVoices({ 0: normalize([0.9, 0.1, 0.1]), 1: normalize([0.1, 0.95, 0]) }, [marco, anna]);
        expect(named.get(0)?.name).toBe('Marco');
        expect(named.get(1)?.name).toBe('Anna');
    });

    it('leaves unknown voices unnamed', () => {
        expect(recognizeVoices({ 0: [0, 0, 1] }, [marco, anna]).size).toBe(0);
    });

    it('gives each known voice to one speaker only, the most similar', () => {
        const named = recognizeVoices({ 0: normalize([0.8, 0.2, 0.3]), 1: normalize([0.95, 0.05, 0]) }, [marco]);
        expect([...named.keys()]).toEqual([1]);
    });

    it('does not guess between two known voices that both match', () => {
        const twin = profile('t', 'Gemello', [0.95, 0.05, 0]);
        expect(recognizeVoices({ 0: normalize([1, 0.02, 0]) }, [marco, twin]).size).toBe(0);
    });
});

describe('learnVoice', () => {
    it('creates a profile, then follows the voice more slowly as meetings add up', () => {
        const first = learnVoice(null, 'Marco', [1, 0], 1);
        expect(first.meetings).toBe(1);
        const second = learnVoice(first, 'Marco', [0, 1], 2);
        expect(second.embedding[0]).toBeCloseTo(Math.SQRT1_2, 3);
        const settled = learnVoice({ ...first, meetings: 20 }, 'Marco', [0, 1], 3);
        expect(settled.embedding[0]).toBeGreaterThan(0.99 * 10 / Math.sqrt(101));
        expect(settled.id).toBe(first.id);
    });
});
