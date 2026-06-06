import { WebPlugin } from '@capacitor/core';

import type { VADPlugin, VADResult, SpeechSegment } from './definitions';

export class VADWeb extends WebPlugin implements VADPlugin {
    async loadModel(_options: { modelPath: string }): Promise<void> {
        throw new Error('VAD is not available on web platform');
    }

    async unloadModel(): Promise<void> {
        throw new Error('VAD is not available on web platform');
    }

    async isModelLoaded(): Promise<{ loaded: boolean }> {
        return { loaded: false };
    }

    async setThresholds(_options: {
        speechThreshold?: number;
        silenceDurationMs?: number;
        minSpeechDurationMs?: number;
    }): Promise<void> {
        throw new Error('VAD is not available on web platform');
    }

    async processSamples(_options: { samples: string }): Promise<VADResult> {
        throw new Error('VAD is not available on web platform');
    }

    async processFile(_options: { audioPath: string }): Promise<{ segments: SpeechSegment[] }> {
        throw new Error('VAD is not available on web platform');
    }

    async reset(): Promise<void> {
        throw new Error('VAD is not available on web platform');
    }

    async copyFile(_options: {
        sourcePath: string;
        fileName: string;
    }): Promise<{ path: string }> {
        throw new Error('VAD is not available on web platform');
    }
}
