import { WebPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type {
    LiteRTPlugin,
    LiteRTInitOptions,
    LiteRTInitResult,

    LiteRTGenerateOptions,
    LiteRTGenerateResult,
    LiteRTTokenEvent,
} from './definitions.js';

export class LiteRTWeb extends WebPlugin implements LiteRTPlugin {
    async initModel(_options: LiteRTInitOptions): Promise<LiteRTInitResult> {
        throw new Error('LiteRT is not available on web platform');
    }

    async generateResponse(_options: LiteRTGenerateOptions): Promise<LiteRTGenerateResult> {
        throw new Error('LiteRT is not available on web platform');
    }

    async generateResponseStream(_options: LiteRTGenerateOptions, _callback: (result: LiteRTGenerateResult) => void): Promise<string> {
        throw new Error('LiteRT not supported on web');
    }

    async stopGeneration(): Promise<void> {
        throw new Error('LiteRT is not available on web platform');
    }



    async releaseModel(): Promise<void> {
        throw new Error('LiteRT is not available on web platform');
    }

    async isModelLoaded(): Promise<{ loaded: boolean }> {
        return { loaded: false };
    }

    async addListener(
        eventName: 'liteRTToken',
        listenerFunc: (event: LiteRTTokenEvent) => void
    ): Promise<PluginListenerHandle> {
        return super.addListener(eventName, listenerFunc as any);
    }
}
