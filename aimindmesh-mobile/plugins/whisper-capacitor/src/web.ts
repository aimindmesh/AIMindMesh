import { WebPlugin } from '@capacitor/core';

import type { WhisperPlugin, TranscriptSegment } from './definitions';

export class WhisperWeb extends WebPlugin implements WhisperPlugin {
    async loadModel(_options: { modelPath: string }): Promise<void> {
        throw new Error('Whisper is not available on web platform');
    }

    async unloadModel(): Promise<void> {
        throw new Error('Whisper is not available on web platform');
    }

    async isModelLoaded(): Promise<{ loaded: boolean }> {
        return { loaded: false };
    }

    async getDeviceOptimization(): Promise<any> {
        return {
            soc: 'UNKNOWN',
            availableCores: 4,
            recommendedThreads: 4,
            recommendedModel: 'ggml-tiny',
            hasNpu: false,
            npuArch: 'none',
            recommendedBackend: 'cpu',
            deviceInfo: 'Web/Browser'
        };
    }

    async transcribe(_options: {
        audioPath: string;
        language?: string;
        translate?: boolean;
    }): Promise<{ text: string; segments: TranscriptSegment[]; processingTimeMs: number }> {
        throw new Error('Whisper is not available on web platform');
    }

    async transcribeAudio(_options: {
        audioData: string;
        language?: string;
    }): Promise<{ text: string; segments: TranscriptSegment[] }> {
        throw new Error('Whisper is not available on web platform');
    }

    async transcribeRange(_options: {
        audioPath: string;
        startMs: number;
        endMs: number;
    }): Promise<{ text: string; segments: TranscriptSegment[]; language: string; processingTimeMs: number }> {
        throw new Error('Whisper is not available on web platform');
    }

    async abort(): Promise<void> {
        // nothing to abort on web
    }

    async copyFile(_options: {
        sourcePath: string;
        fileName: string;
    }): Promise<{ path: string }> {
        throw new Error('Whisper is not available on web platform');
    }

    async transcribeStream(_options: {
        audioPath: string;
        language?: string;
        chunkSize?: number;
    }): Promise<{
        complete: boolean;
        chunks: {
            chunkIndex: number;
            text: string;
            segments: TranscriptSegment[];
            startTime: number;
        }[];
    }> {
        throw new Error('Whisper is not available on web platform');
    }
}
