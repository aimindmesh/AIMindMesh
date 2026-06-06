import { WebPlugin } from '@capacitor/core';

import type { TextEmbeddingPlugin, EmbeddingResult, ModelInfo } from './definitions';

export class TextEmbeddingWeb extends WebPlugin implements TextEmbeddingPlugin {
    async loadModel(_options: { modelDir: string }): Promise<{ dimension: number }> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }

    async unloadModel(): Promise<void> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }

    async isModelLoaded(): Promise<ModelInfo> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }

    async generateEmbedding(_options: { text: string }): Promise<EmbeddingResult> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }

    async generateEmbeddingBatch(_options: { texts: string[] }): Promise<{ embeddings: EmbeddingResult[] }> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }

    async importModelZip(_options: { sourcePath: string; modelId: string }): Promise<{ path: string; modelId: string }> {
        throw this.unimplemented('TextEmbedding is not supported on web platform');
    }
}
