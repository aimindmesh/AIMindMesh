import { WebPlugin } from '@capacitor/core';

import type { SpeakerEmbeddingPlugin, EmbeddingResult, ModelInfo } from './definitions';

export class SpeakerEmbeddingWeb extends WebPlugin implements SpeakerEmbeddingPlugin {
    async loadModel(_options: { modelPath: string }): Promise<void> {
        throw this.unimplemented('SpeakerEmbedding is not supported on web platform');
    }

    async unloadModel(): Promise<void> {
        throw this.unimplemented('SpeakerEmbedding is not supported on web platform');
    }

    async isModelLoaded(): Promise<{ loaded: boolean }> {
        throw this.unimplemented('SpeakerEmbedding is not supported on web platform');
    }

    async extractEmbedding(_options: { audioData: string }): Promise<EmbeddingResult> {
        throw this.unimplemented('SpeakerEmbedding is not supported on web platform');
    }

    async getModelInfo(): Promise<ModelInfo> {
        throw this.unimplemented('SpeakerEmbedding is not supported on web platform');
    }
}
