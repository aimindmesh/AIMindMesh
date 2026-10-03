import { TranscriptSegment } from '../../types/meeting';

export interface TimedEmbedding {
    /** Window position in the recording (ms) */
    startMs: number;
    endMs: number;
    embedding: number[];
}

export function hasSegmentTiming(seg: TranscriptSegment): seg is TranscriptSegment & { start_ms: number; end_ms: number } {
    return seg.start_ms !== undefined && seg.end_ms !== undefined && seg.end_ms > seg.start_ms;
}

function averageEmbedding(vectors: number[][]): number[] {
    const avg = new Array(vectors[0].length).fill(0);
    for (const v of vectors) {
        for (let i = 0; i < avg.length; i++) avg[i] += v[i] ?? 0;
    }
    for (let i = 0; i < avg.length; i++) avg[i] /= vectors.length;
    return avg;
}

/**
 * Gives each timed segment the speaker whose centroid is closest to the average of the audio
 * windows overlapping it. Segment and window times are both positions in the recording; the old
 * code compared wall-clock timestamps with audio offsets, so every segment got the same speaker.
 * Segments without timing keep their speaker.
 */
export function assignSpeakersByTime(
    segments: TranscriptSegment[],
    windows: TimedEmbedding[],
    centroids: number[][],
    nearest: (embedding: number[], centroids: number[][]) => number
): TranscriptSegment[] {
    if (windows.length === 0 || centroids.length === 0) return segments;

    return segments.map(seg => {
        if (!hasSegmentTiming(seg)) return seg;
        let relevant = windows.filter(w => w.startMs < seg.end_ms && w.endMs > seg.start_ms);
        if (relevant.length === 0) {
            const mid = (seg.start_ms + seg.end_ms) / 2;
            let best = windows[0];
            let bestDistance = Infinity;
            for (const w of windows) {
                const distance = Math.abs((w.startMs + w.endMs) / 2 - mid);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = w;
                }
            }
            relevant = [best];
        }
        const speakerId = nearest(averageEmbedding(relevant.map(w => w.embedding)), centroids);
        return speakerId === seg.speakerId ? seg : { ...seg, speakerId };
    });
}
