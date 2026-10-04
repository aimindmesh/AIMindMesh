import { TimeRange } from './chunkPlanner';

/**
 * Cuts speech regions into short windows for voice embeddings. Regions stop at pauses, where
 * turns usually change, so each window most likely holds one voice; long regions are cut in
 * equal windows of about `windowMs` so a turn change without a pause is caught too.
 * Regions shorter than `minMs` give no window (too short to tell voices apart).
 */
export function speechWindows(speech: TimeRange[], windowMs = 3000, minMs = 1000): TimeRange[] {
    const windows: TimeRange[] = [];
    for (const r of speech) {
        const length = r.endMs - r.startMs;
        if (length < minMs) continue;
        const parts = Math.max(1, Math.round(length / windowMs));
        for (let p = 0; p < parts; p++) {
            windows.push({
                startMs: Math.round(r.startMs + (length * p) / parts),
                endMs: Math.round(r.startMs + (length * (p + 1)) / parts),
            });
        }
    }
    return windows;
}

/**
 * Gives each transcript segment the speaker who talks most during it, from speaker-labelled
 * windows. Segments overlapping no window get the speaker of the nearest window.
 */
export function speakersByOverlap(
    segments: Array<{ id: string } & TimeRange>,
    windows: Array<TimeRange & { speaker: number }>
): Map<string, number> {
    const result = new Map<string, number>();
    if (windows.length === 0) {
        segments.forEach(s => result.set(s.id, 0));
        return result;
    }
    for (const seg of segments) {
        const talk = new Map<number, number>();
        for (const w of windows) {
            const overlap = Math.min(seg.endMs, w.endMs) - Math.max(seg.startMs, w.startMs);
            if (overlap > 0) talk.set(w.speaker, (talk.get(w.speaker) ?? 0) + overlap);
        }
        if (talk.size > 0) {
            result.set(seg.id, [...talk.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
            continue;
        }
        const mid = (seg.startMs + seg.endMs) / 2;
        const nearest = windows.reduce((a, b) =>
            Math.abs((b.startMs + b.endMs) / 2 - mid) < Math.abs((a.startMs + a.endMs) / 2 - mid) ? b : a);
        result.set(seg.id, nearest.speaker);
    }
    return result;
}
