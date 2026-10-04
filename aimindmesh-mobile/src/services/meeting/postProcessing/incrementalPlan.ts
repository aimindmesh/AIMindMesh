/**
 * Planning for transcription while recording: which speech is finished and can be transcribed
 * now, and, once speakers are known, which transcribed sentences span a change of speaker.
 */

import { planChunks, TimeRange } from './chunkPlanner';
import { buildSpeakerChunks, SpeakerRange } from './speakerChunks';

/**
 * Chunks while recording: cut at every pause of 0.3 s or more (padding 150 ms on each side
 * joins shorter ones), since turns change at pauses and a chunk spanning two speakers has to be
 * transcribed again at the end; kept under 20 s so a chunk is done soon after it is spoken.
 */
export const LIVE_CHUNK_PLAN = { maxChunkMs: 20_000, padMs: 150, maxGapMs: 0 };

/**
 * Adds the speech regions of a new voice-activity scan. Regions starting before the end of
 * the last known one are dropped: scans overlap a little so no speech onset is missed.
 */
export function appendSpeech(known: TimeRange[], scanned: TimeRange[]): TimeRange[] {
    const lastEnd = known.length ? known[known.length - 1].endMs : -Infinity;
    return [...known, ...scanned.filter(r => r.startMs >= lastEnd)];
}

/**
 * Chunks of finished speech after `fromMs`, and where the next ones will start. A chunk is
 * final once the silence after it is longer than the chunk gap plus padding: later speech
 * can't join it.
 *
 * @param speech closed speech regions, in order
 * @param settledUntilMs no speech can start before this (start of speech still going on, or
 *   the end of the audio scanned so far)
 * @param final the recording is over: everything left is final
 */
export function readyChunks(
    speech: TimeRange[],
    fromMs: number,
    settledUntilMs: number,
    final: boolean
): { chunks: TimeRange[]; nextFromMs: number } {
    const pending = speech.filter(r => r.endMs > fromMs).map(r => ({ startMs: Math.max(r.startMs, fromMs), endMs: r.endMs }));
    const planned = planChunks(pending, settledUntilMs, LIVE_CHUNK_PLAN).map(c => ({ ...c, startMs: Math.max(c.startMs, fromMs) }));
    const joinable = LIVE_CHUNK_PLAN.maxGapMs + LIVE_CHUNK_PLAN.padMs;
    const chunks = final ? planned : planned.filter(c => c.endMs + joinable <= settledUntilMs);
    return { chunks, nextFromMs: chunks.length ? chunks[chunks.length - 1].endMs : fromMs };
}

/** How long each speaker talks within a range. */
function talkBySpeaker(range: TimeRange, labelled: SpeakerRange[]): Map<number, number> {
    const talk = new Map<number, number>();
    for (const p of labelled) {
        const overlap = Math.min(range.endMs, p.endMs) - Math.max(range.startMs, p.startMs);
        if (overlap > 0) talk.set(p.speaker, (talk.get(p.speaker) ?? 0) + overlap);
    }
    return talk;
}

/**
 * True when someone besides the main speaker talks at least `minorityMs` within the range:
 * a sentence Whisper wrote across a change of speaker.
 */
export function spansSpeakerChange(range: TimeRange, labelled: SpeakerRange[], minorityMs = 1200): boolean {
    const talk = [...talkBySpeaker(range, labelled).values()].sort((a, b) => b - a);
    return talk.length > 1 && talk[1] >= minorityMs;
}

/** The ranges to transcribe again so that each holds one speaker, within `range`. */
export function turnsWithin(range: TimeRange, labelled: SpeakerRange[]): SpeakerRange[] {
    const inside = labelled
        .map(p => ({ ...p, startMs: Math.max(p.startMs, range.startMs), endMs: Math.min(p.endMs, range.endMs) }))
        .filter(p => p.endMs > p.startMs);
    return buildSpeakerChunks(inside, range.endMs)
        .map(c => ({ ...c, startMs: Math.max(c.startMs, range.startMs) }))
        .filter(c => c.endMs > c.startMs);
}
