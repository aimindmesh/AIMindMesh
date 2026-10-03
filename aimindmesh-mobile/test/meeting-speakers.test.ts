import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { alignClusterLabels } from '../src/services/speaker/labelAlignment';
import { assignSpeakersByTime } from '../src/services/speaker/segmentAssignment';
import { AhcStrategy } from '../src/services/speaker/clustering/AhcStrategy';
import { SpeakerEmbedding } from '../src/services/speaker/speakerEmbedding';
import { TranscriptSegment } from '../src/types/meeting';

const unit = (angle: number) => [Math.cos(angle), Math.sin(angle)];

describe('cluster label alignment', () => {
  it('maps clusters to the speaker ids they overlap most', () => {
    const labels = alignClusterLabels([
      { previous: 2, cluster: 0 }, { previous: 2, cluster: 0 }, { previous: 0, cluster: 0 },
      { previous: 0, cluster: 1 }, { previous: 0, cluster: 1 },
      { previous: undefined, cluster: 2 }
    ]);
    expect(labels.get(0)).toBe(2);
    expect(labels.get(1)).toBe(0);
    expect(labels.get(2)).toBe(3); // new speaker: after every id in use
  });

  it('never gives a new cluster an id below nextFreeId', () => {
    const labels = alignClusterLabels([{ previous: 0, cluster: 0 }, { previous: 0, cluster: 1 }], 5);
    expect(labels.get(0)).toBe(0);
    expect(labels.get(1)).toBe(5);
  });
});

describe('segment assignment by time', () => {
  it('uses the windows overlapping each segment (positions in the recording)', () => {
    const seg = (id: string, start?: number, end?: number): TranscriptSegment =>
      ({ id, speakerId: 9, text: id, timestamp: 1_700_000_000_000, start_ms: start, end_ms: end });
    const windows = [
      { startMs: 0, endMs: 2500, embedding: unit(0) },
      { startMs: 3000, endMs: 5500, embedding: unit(Math.PI / 2) }
    ];
    const nearest = (e: number[], centroids: number[][]) =>
      centroids.reduce((best, c, i) => (e[0] * c[0] + e[1] * c[1] > e[0] * centroids[best][0] + e[1] * centroids[best][1] ? i : best), 0);
    const result = assignSpeakersByTime(
      [seg('a', 0, 2000), seg('b', 3500, 5000), seg('c', 9000, 9500), seg('d')],
      windows,
      [unit(0), unit(Math.PI / 2)],
      nearest
    );
    expect(result.map(s => s.speakerId)).toEqual([0, 1, 1, 9]);
  });
});

describe('AHC clustering', () => {
  it('separates two speakers and orders clusters by first appearance', () => {
    const embeddings = [0, 0.05, 1.6, 0.02, 1.55, 1.58].map((a, i) => ({ id: `e${i}`, embedding: unit(a), timestamp: i }));
    const result = new AhcStrategy().cluster(embeddings, { distanceThreshold: 0.3 });
    expect(result.speakerCount).toBe(2);
    expect(['e0', 'e1', 'e3'].map(id => result.speakerAssignments.get(id))).toEqual([0, 0, 0]);
    expect(['e2', 'e4', 'e5'].map(id => result.speakerAssignments.get(id))).toEqual([1, 1, 1]);
  });

  it('stops at the target speaker count', () => {
    const embeddings = [0, 0.5, 1, 1.5].map((a, i) => ({ id: `e${i}`, embedding: unit(a), timestamp: i }));
    expect(new AhcStrategy().cluster(embeddings, { targetSpeakers: 2 }).speakerCount).toBe(2);
  });
});

describe('periodic recluster', () => {
  it('keeps the enrolled user as Speaker 0 (ids used to shift by one)', () => {
    localStorage.setItem('user-voice-profile-onnx', JSON.stringify(unit(0)));
    const service = new SpeakerEmbedding(() => { });
    const user = [0, 0.02, 0.04].map(unit);
    const other = [1.5, 1.52, 1.54].map(unit);
    user.forEach((e, i) => service.storeEmbedding(`u${i}`, e, i, 0));
    other.forEach((e, i) => service.storeEmbedding(`o${i}`, e, 10 + i, 1));

    const corrections = service.periodicRecluster()!;
    expect(['u0', 'u1', 'u2'].map(id => corrections.get(id))).toEqual([0, 0, 0]);
    expect(['o0', 'o1', 'o2'].map(id => corrections.get(id))).toEqual([1, 1, 1]);
    // The enrolled profile is not replaced by the session centroid
    expect(service.getCentroids()[0]).toEqual(unit(0));
  });
});
