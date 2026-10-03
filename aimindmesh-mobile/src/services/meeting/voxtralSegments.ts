import { TranscriptSegment } from '../../types/meeting';

export interface VoxtralCursor {
    /** Index in the accumulated transcript where the open segment starts */
    segmentStart: number;
    /** Segment still receiving text; null when the next text opens a new one */
    segmentId: string | null;
}

export const initialVoxtralCursor = (): VoxtralCursor => ({ segmentStart: 0, segmentId: null });

/** Text received while paused is skipped: the next segment starts after it. */
export function skipVoxtralText(accumulated: string): VoxtralCursor {
    return { segmentStart: accumulated.length, segmentId: null };
}

/**
 * Voxtral reports the whole transcript accumulated since start. Each segment must own only the
 * slice spoken while it was open: storing the full text made every speaker change repeat the
 * entire meeting.
 */
export function applyVoxtralUpdate(
    prev: TranscriptSegment[],
    cursor: VoxtralCursor,
    accumulated: string,
    newText: string,
    speakerId: number,
    timing: { startMs: number; endMs: number },
    makeId: () => string,
    now: number
): { segments: TranscriptSegment[]; cursor: VoxtralCursor } {
    let openIndex = -1;
    if (cursor.segmentId) {
        for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].id === cursor.segmentId) {
                openIndex = i;
                break;
            }
        }
    }
    const open = openIndex >= 0 ? prev[openIndex] : null;

    if (open && open.speakerId === speakerId) {
        const segments = [...prev];
        segments[openIndex] = {
            ...open,
            text: accumulated.slice(cursor.segmentStart).trim(),
            end_ms: Math.max(open.end_ms ?? timing.endMs, timing.endMs)
        };
        return { segments, cursor };
    }

    const boundary = Math.min(accumulated.length, Math.max(cursor.segmentStart, accumulated.length - newText.length));
    const text = accumulated.slice(boundary).trim();
    if (!text) return { segments: prev, cursor };

    const id = makeId();
    const segment: TranscriptSegment = {
        id,
        speakerId,
        text,
        timestamp: now,
        start_ms: timing.startMs,
        end_ms: timing.endMs,
        stt_provider: 'voxtral'
    };
    return { segments: [...prev, segment], cursor: { segmentStart: boundary, segmentId: id } };
}
