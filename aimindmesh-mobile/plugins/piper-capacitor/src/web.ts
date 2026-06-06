import { WebPlugin } from '@capacitor/core';

import type { PiperPlugin } from './definitions';

export class PiperWeb extends WebPlugin implements PiperPlugin {
    async loadVoice(_options: { modelPath: string; configPath: string }): Promise<void> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async unloadVoice(): Promise<void> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async synthesize(_options: { text: string }): Promise<{ audioPath: string }> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async speak(_options: { text: string }): Promise<void> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async downloadVoice(_options: { url: string; path: string }): Promise<{ path: string }> {
        throw new Error('Method not implemented on web.');
    }

    async copyFile(_options: { sourcePath: string; fileName: string }): Promise<{ path: string }> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async stop(): Promise<void> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async isVoiceLoaded(): Promise<{ loaded: boolean }> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async getVoiceInfo(): Promise<{ voiceId: string | null }> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async setAudioOutput(_options: { output: 'speaker' | 'earpiece' | 'bluetooth' | 'wired' }): Promise<void> {
        throw this.unimplemented('Piper is not supported on web platform');
    }

    async getAvailableAudioOutputs(): Promise<{ outputs: ('speaker' | 'earpiece' | 'bluetooth' | 'wired')[] }> {
        throw this.unimplemented('Piper is not supported on web platform');
    }
}
