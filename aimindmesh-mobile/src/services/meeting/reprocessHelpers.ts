import { TranscriptSegment } from '../../types/meeting';

interface WhisperLikeResult {
    text: string;
    segments?: Array<{ text: string; startMs: number; endMs: number; confidence?: number }>;
}

/**
 * Whisper output to transcript segments placed on the recording timeline. Reprocessed segments
 * had no start/end, so tap-to-play, exports and "Diarize Audio" could not use them.
 */
export function whisperResultToSegments(
    result: WhisperLikeResult,
    opts: { offsetMs: number; durationMs?: number; meetingTimestamp: number; makeId: () => string; speakerId?: number }
): TranscriptSegment[] {
    const speakerId = opts.speakerId ?? 0;
    if (result.segments && result.segments.length > 0) {
        return result.segments
            .filter(seg => seg.text.trim().length > 0)
            .map(seg => {
                const start = Math.round(opts.offsetMs + seg.startMs);
                const end = Math.round(opts.offsetMs + seg.endMs);
                return {
                    id: opts.makeId(),
                    speakerId,
                    text: seg.text.trim(),
                    timestamp: opts.meetingTimestamp + start,
                    start_ms: start,
                    end_ms: end,
                    stt_provider: 'whisper',
                    confidence: seg.confidence
                };
            });
    }
    if (result.text && result.text.trim()) {
        const start = Math.round(opts.offsetMs);
        return [{
            id: opts.makeId(),
            speakerId,
            text: result.text.trim(),
            timestamp: opts.meetingTimestamp + start,
            start_ms: start,
            end_ms: opts.durationMs !== undefined ? Math.round(opts.offsetMs + opts.durationMs) : undefined,
            stt_provider: 'whisper'
        }];
    }
    return [];
}

/** Consecutive [start, end) sample ranges covering the audio. */
export function planChunks(totalSamples: number, chunkSamples: number): Array<{ start: number; end: number }> {
    const chunks: Array<{ start: number; end: number }> = [];
    if (chunkSamples <= 0) return chunks;
    for (let start = 0; start < totalSamples; start += chunkSamples) {
        chunks.push({ start, end: Math.min(totalSamples, start + chunkSamples) });
    }
    return chunks;
}

export interface WavInfo {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    /** Byte offset of the PCM data */
    dataOffset: number;
    /** Byte length of the PCM data (0 when the header does not say) */
    dataLength: number;
}

/** Reads a RIFF/WAVE header by walking its chunks (the data offset is not always 44). */
export function parseWavHeader(buffer: ArrayBuffer): WavInfo | null {
    if (buffer.byteLength < 12) return null;
    const view = new DataView(buffer);
    const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

    let offset = 12;
    let format: Omit<WavInfo, 'dataOffset' | 'dataLength'> | null = null;
    while (offset + 8 <= buffer.byteLength) {
        const id = tag(offset);
        const size = view.getUint32(offset + 4, true);
        if (id === 'fmt ' && offset + 24 <= buffer.byteLength) {
            format = {
                channels: view.getUint16(offset + 10, true),
                sampleRate: view.getUint32(offset + 12, true),
                bitsPerSample: view.getUint16(offset + 22, true)
            };
        } else if (id === 'data') {
            return format ? { ...format, dataOffset: offset + 8, dataLength: size } : null;
        }
        offset += 8 + size + (size % 2);
    }
    return null;
}
