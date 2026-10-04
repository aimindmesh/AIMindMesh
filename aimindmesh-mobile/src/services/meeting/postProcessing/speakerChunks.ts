import { TimeRange } from './chunkPlanner';

export interface SpeakerRange extends TimeRange {
    speaker: number;
}

export interface SpeakerChunkOptions {
    maxChunkMs: number;
    padMs: number;
    /** A silence longer than this ends the chunk, even within one speaker's talk. */
    maxGapMs: number;
}

export const DEFAULT_SPEAKER_CHUNKS: SpeakerChunkOptions = { maxChunkMs: 28_000, padMs: 250, maxGapMs: 3000 };

/**
 * Labels every speech region with a speaker: windows already have one; regions too short for a
 * voice embedding (a quick "sì") take the speaker of the nearest window, so they are still
 * transcribed.
 */
export function labelSpeech(windows: SpeakerRange[], shortRegions: TimeRange[]): SpeakerRange[] {
    if (windows.length === 0) return shortRegions.map(r => ({ ...r, speaker: 0 }));
    const labelled = shortRegions.map(r => {
        const mid = (r.startMs + r.endMs) / 2;
        const nearest = windows.reduce((a, b) =>
            Math.abs((b.startMs + b.endMs) / 2 - mid) < Math.abs((a.startMs + a.endMs) / 2 - mid) ? b : a);
        return { ...r, speaker: nearest.speaker };
    });
    return [...windows, ...labelled].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Groups speaker-labelled speech into the ranges to transcribe, one speaker per range: runs of
 * the same speaker (closer than `maxGapMs`) are joined, a change of speaker always starts a new
 * range, and runs longer than `maxChunkMs` are split evenly. Every Whisper segment of a range
 * then belongs to that range's speaker, however Whisper cuts its sentences.
 */
export function buildSpeakerChunks(
    pieces: SpeakerRange[],
    durationMs: number,
    options: SpeakerChunkOptions = DEFAULT_SPEAKER_CHUNKS
): SpeakerRange[] {
    const { maxChunkMs, padMs, maxGapMs } = options;
    const turns: SpeakerRange[] = [];
    for (const p of [...pieces].sort((a, b) => a.startMs - b.startMs)) {
        const last = turns[turns.length - 1];
        if (last && last.speaker === p.speaker && p.startMs - last.endMs <= maxGapMs) {
            last.endMs = Math.max(last.endMs, p.endMs);
        } else {
            turns.push({ ...p });
        }
    }

    const chunks: SpeakerRange[] = [];
    turns.forEach((turn, i) => {
        const prevEnd = chunks.length ? chunks[chunks.length - 1].endMs : 0;
        const nextStart = i + 1 < turns.length ? turns[i + 1].startMs : durationMs;
        const startMs = Math.max(prevEnd, turn.startMs - padMs, 0);
        const endMs = Math.min(nextStart, turn.endMs + padMs, durationMs);
        const length = endMs - startMs;
        if (length <= 0) return;
        const parts = Math.max(1, Math.ceil(length / maxChunkMs));
        for (let k = 0; k < parts; k++) {
            chunks.push({
                startMs: Math.round(startMs + (length * k) / parts),
                endMs: Math.round(startMs + (length * (k + 1)) / parts),
                speaker: turn.speaker,
            });
        }
    });
    return chunks;
}
