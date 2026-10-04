export interface TimeRange {
    startMs: number;
    endMs: number;
}

export interface ChunkPlanOptions {
    /** whisper.cpp encodes 30 s windows: chunks up to this length cost the same as shorter ones. */
    maxChunkMs: number;
    /** Audio kept around each speech region, so word edges are not cut. */
    padMs: number;
    /** A silence longer than this ends the chunk: no long silences inside chunks. */
    maxGapMs: number;
}

export const DEFAULT_CHUNK_PLAN: ChunkPlanOptions = { maxChunkMs: 28_000, padMs: 250, maxGapMs: 3000 };

/**
 * Splits a recording into the ranges to transcribe.
 *
 * With voice activity (`speech`), consecutive speech regions are packed into chunks of up to
 * `maxChunkMs`, so chunks begin and end in silence (no word cut in half) and silences longer
 * than `maxGapMs` are skipped instead of transcribed (Whisper tends to hallucinate in them).
 * A region longer than `maxChunkMs` is split into equal parts. An empty `speech` list means
 * a silent recording.
 *
 * Without voice activity (`speech` null, e.g. VAD unavailable), the recording is cut into
 * consecutive `maxChunkMs` ranges.
 */
export function planChunks(
    speech: TimeRange[] | null,
    durationMs: number,
    options: ChunkPlanOptions = DEFAULT_CHUNK_PLAN
): TimeRange[] {
    const { maxChunkMs, padMs, maxGapMs } = options;

    if (speech === null) {
        const chunks: TimeRange[] = [];
        for (let start = 0; start < durationMs; start += maxChunkMs) {
            chunks.push({ startMs: start, endMs: Math.min(durationMs, start + maxChunkMs) });
        }
        return chunks;
    }

    // Padded regions, clamped to the recording, in order, without overlaps
    const regions: TimeRange[] = [];
    for (const r of [...speech].sort((a, b) => a.startMs - b.startMs)) {
        let startMs = Math.max(0, r.startMs - padMs);
        const endMs = Math.min(durationMs, r.endMs + padMs);
        const prev = regions[regions.length - 1];
        if (prev && startMs <= prev.endMs) {
            if (endMs > prev.endMs) prev.endMs = endMs; // overlapping after padding: one region
            continue;
        }
        startMs = Math.max(startMs, prev ? prev.endMs : 0);
        if (endMs > startMs) regions.push({ startMs, endMs });
    }

    const chunks: TimeRange[] = [];
    for (const region of regions) {
        const current = chunks[chunks.length - 1];
        if (current && region.endMs - current.startMs <= maxChunkMs && region.startMs - current.endMs <= maxGapMs) {
            current.endMs = region.endMs;
            continue;
        }
        const length = region.endMs - region.startMs;
        const parts = Math.max(1, Math.ceil(length / maxChunkMs));
        for (let p = 0; p < parts; p++) {
            chunks.push({
                startMs: Math.round(region.startMs + (length * p) / parts),
                endMs: Math.round(region.startMs + (length * (p + 1)) / parts)
            });
        }
    }
    return chunks;
}
