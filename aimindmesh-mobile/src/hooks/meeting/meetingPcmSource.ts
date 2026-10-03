import { Capacitor } from '@capacitor/core';
import AudioConverter from '../../services/audio/audioConverter';
import { downsampleBuffer } from '../../services/audio/audioUtils';
import { toNativePath } from '../../services/meeting/audioPaths';
import { parseWavHeader } from '../../services/meeting/reprocessHelpers';
import { logger } from '../../services/logger';

const SAMPLE_RATE = 16000;

/** 16 kHz mono audio of a meeting, read window by window. */
export interface PcmSource {
    totalSamples: number;
    /** Plain path of a decoded 16 kHz WAV when one exists (for file-based plugins) */
    wavPath: string | null;
    read(start: number, count: number): Promise<Float32Array>;
}

function int16BytesToFloat(buffer: ArrayBuffer): Float32Array {
    const int16 = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2));
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768.0;
    return out;
}

/**
 * Native decode to WAV, then reads slices of it: a long meeting is never expanded to Float32 at
 * the WebView's 48 kHz in one piece (that ran out of memory).
 */
async function openDecodedWav(audioFilePath: string): Promise<PcmSource | null> {
    const { filePath: wavPath } = await AudioConverter.decodeM4AToWav({ filePath: toNativePath(audioFilePath) });
    const blob = await (await fetch(Capacitor.convertFileSrc(wavPath))).blob();
    const info = parseWavHeader(await blob.slice(0, 4096).arrayBuffer());
    if (!info || info.sampleRate !== SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) {
        logger.log('warn', 'Decoded audio is not 16 kHz mono PCM, using the in-memory decoder', info);
        return null;
    }
    const dataBytes = info.dataLength > 0 ? Math.min(info.dataLength, blob.size - info.dataOffset) : blob.size - info.dataOffset;
    return {
        totalSamples: Math.floor(dataBytes / 2),
        wavPath,
        read: async (start, count) => {
            const from = info.dataOffset + start * 2;
            return int16BytesToFloat(await blob.slice(from, from + count * 2).arrayBuffer());
        }
    };
}

/** Whole-file decode through Web Audio (legacy blobs without a native file). */
async function openWithWebAudio(audioUrl: string): Promise<PcmSource> {
    const arrayBuffer = await (await fetch(audioUrl)).arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext: AudioContext = new AudioContextClass();
    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const data = downsampleBuffer(audioBuffer.getChannelData(0), audioBuffer.sampleRate, SAMPLE_RATE);
        return {
            totalSamples: data.length,
            wavPath: null,
            read: async (start, count) => data.slice(start, start + count)
        };
    } finally {
        // Contexts are a limited resource: an unclosed one per run eventually failed to open
        audioContext.close().catch(() => { });
    }
}

export async function openMeetingPcm(audioUrl: string | null, audioFilePath: string | null): Promise<PcmSource> {
    if (audioFilePath) {
        try {
            const source = await openDecodedWav(audioFilePath);
            if (source) return source;
        } catch (e) {
            logger.log('warn', 'Native decode failed, using the in-memory decoder', e);
        }
    }
    if (!audioUrl) throw new Error('No audio to analyze');
    return openWithWebAudio(audioUrl);
}
