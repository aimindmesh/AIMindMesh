import { TranscriptSegment } from '../../types/meeting';

export interface TimedText {
    text: string;
    /** Position in the recording (ms) */
    startMs: number;
    endMs: number;
    confidence?: number;
}

function hasTiming(seg: TranscriptSegment): seg is TranscriptSegment & { start_ms: number; end_ms: number } {
    return seg.start_ms !== undefined && seg.end_ms !== undefined && seg.end_ms > seg.start_ms;
}

/**
 * Hybrid mode: Whisper re-transcribes a window and each Whisper segment goes to the live segment
 * containing its midpoint (or overlapping it most). One Whisper sentence therefore never overwrites
 * several live segments, and segments without timing, user edits and already refined segments are
 * left alone.
 */
export function mergeWhisperRefinement(segments: TranscriptSegment[], refined: TimedText[]): TranscriptSegment[] {
    const targets = new Map<number, TimedText[]>();

    for (const r of refined) {
        if (!r.text.trim() || r.endMs <= r.startMs) continue;
        const mid = (r.startMs + r.endMs) / 2;
        let best = -1;
        let bestOverlap = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.stt_provider === 'whisper' || seg.isEdited || !hasTiming(seg)) continue;
            if (mid >= seg.start_ms && mid <= seg.end_ms) {
                best = i;
                break;
            }
            const overlap = Math.min(seg.end_ms, r.endMs) - Math.max(seg.start_ms, r.startMs);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                best = i;
            }
        }
        if (best >= 0) targets.set(best, [...(targets.get(best) ?? []), r]);
    }

    if (targets.size === 0) return segments;

    return segments.map((seg, i) => {
        const parts = targets.get(i);
        if (!parts) return seg;
        const confidence = parts.reduce((sum, p) => sum + (p.confidence ?? 0.85), 0) / parts.length;
        return {
            ...seg,
            text: parts.map(p => p.text.trim()).join(' '),
            stt_provider: 'whisper',
            confidence
        };
    });
}
