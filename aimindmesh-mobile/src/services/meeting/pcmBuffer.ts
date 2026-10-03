/**
 * Rolling PCM buffer helpers (Float32 chunks at 16 kHz). Offsets are absolute sample counts from
 * the start of the recording, so they stay valid after old chunks are trimmed: index-based
 * offsets stopped Whisper Live once the 5-minute buffer started rolling.
 */

export interface PcmRead {
    samples: Float32Array;
    /** Absolute offset where the returned audio really starts */
    startOffset: number;
    /** Absolute offset to read from next time */
    newOffset: number;
}

export function countSamples(chunks: Float32Array[]): number {
    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    return total;
}

/** Appends a chunk and trims the oldest chunks beyond maxSamples; returns the samples trimmed. */
export function appendBounded(chunks: Float32Array[], chunk: Float32Array, maxSamples: number): number {
    chunks.push(chunk);
    let total = countSamples(chunks);
    let dropped = 0;
    while (total > maxSamples && chunks.length > 1) {
        const removed = chunks.shift()!;
        total -= removed.length;
        dropped += removed.length;
    }
    return dropped;
}

function copyRange(chunks: Float32Array[], relativeStart: number, count: number): Float32Array {
    const out = new Float32Array(count);
    let skip = relativeStart;
    let written = 0;
    for (const chunk of chunks) {
        if (written >= count) break;
        if (skip >= chunk.length) {
            skip -= chunk.length;
            continue;
        }
        const take = Math.min(chunk.length - skip, count - written);
        out.set(chunk.subarray(skip, skip + take), written);
        written += take;
        skip = 0;
    }
    return out;
}

/**
 * Reads up to maxSamples from an absolute offset. Audio already trimmed (`dropped` samples) is
 * gone: the read then starts at the oldest sample still held and startOffset says so.
 */
export function readSince(chunks: Float32Array[], dropped: number, absOffset: number, maxSamples?: number): PcmRead {
    const total = dropped + countSamples(chunks);
    const start = Math.max(absOffset, dropped);
    if (start >= total) {
        return { samples: new Float32Array(0), startOffset: start, newOffset: Math.max(absOffset, start) };
    }
    let count = total - start;
    if (maxSamples && count > maxSamples) count = maxSamples;
    return { samples: copyRange(chunks, start - dropped, count), startOffset: start, newOffset: start + count };
}

/** Absolute [start, end) range, clipped to the audio still held. */
export function readRange(chunks: Float32Array[], dropped: number, absStart: number, absEnd: number): Float32Array {
    const total = dropped + countSamples(chunks);
    const start = Math.max(absStart, dropped);
    const end = Math.min(absEnd, total);
    if (end <= start) return new Float32Array(0);
    return copyRange(chunks, start - dropped, end - start);
}

/**
 * Window for a speaker embedding: from the end of the utterance back `target` samples, at least
 * `min` long (extending before a short utterance), never past the audio that has arrived.
 */
export function pickEmbeddingWindow(
    available: number,
    utterance: { start: number; end: number } | null,
    target: number,
    min: number
): { start: number; end: number } {
    const end = Math.max(0, Math.min(utterance ? utterance.end : available, available));
    let start = utterance ? Math.max(utterance.start, end - target) : end - target;
    if (end - start < min) start = end - min;
    return { start: Math.max(0, start), end };
}

/** 16-bit mono WAV from Float32 chunks (last-resort audio when the native file failed). */
export function createWavBlobFromFloat32(chunks: Float32Array[], sampleRate: number): Blob {
    const totalLength = countSamples(chunks);
    const int16 = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
            const s = Math.max(-1, Math.min(1, chunk[i]));
            int16[offset++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
    }

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const dataSize = totalLength * 2;
    const writeString = (at: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    return new Blob([header, int16], { type: 'audio/wav' });
}
