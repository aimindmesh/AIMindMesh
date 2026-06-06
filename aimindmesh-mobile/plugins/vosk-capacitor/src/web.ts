import { WebPlugin } from '@capacitor/core';

import type { VoskPlugin, PermissionStatus } from './definitions';

export class VoskWeb extends WebPlugin implements VoskPlugin {
    async checkPermissions(): Promise<PermissionStatus> {
        throw this.unimplemented('Not implemented on web.');
    }

    async requestPermissions(): Promise<PermissionStatus> {
        throw this.unimplemented('Not implemented on web.');
    }

    async loadModel(_options: { modelPath: string }): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async downloadModel(_options: { url: string; path: string }): Promise<{ path: string }> {
        throw new Error('Method not implemented on web.');
    }

    async copyFile(_options: { sourcePath: string; fileName: string }): Promise<{ path: string }> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async unloadModel(): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async startRecognition(): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async stopRecognition(): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async isModelLoaded(): Promise<{ loaded: boolean }> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async getModelInfo(): Promise<{ modelPath: string | null; language: string | null; }> {
        return { modelPath: null, language: null };
    }

    async startProcessing(): Promise<void> {
        console.warn('startProcessing not implemented on web');
    }

    async submitAudio(_options: { data: string }): Promise<void> {
        console.warn('submitAudio not implemented on web');
    }

    async stopProcessing(): Promise<void> {
        console.warn('stopProcessing not implemented on web');
    }

    async loadSpeakerModel(_options: { modelPath: string }): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async unloadSpeakerModel(): Promise<void> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }

    async isSpeakerModelLoaded(): Promise<{ loaded: boolean }> {
        throw this.unimplemented('Vosk is not supported on web platform');
    }
}
