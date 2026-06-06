// Speaker Embedding Plugin - ONNX ECAPA-TDNN speaker embedding extraction

export interface SpeakerEmbeddingPlugin {
    /**
     * Load an ONNX ECAPA-TDNN model for speaker embedding extraction.
     * @param options.modelPath Relative path to ONNX model file (e.g., 'models/ecapa_tdnn.onnx')
     */
    loadModel(options: { modelPath: string }): Promise<void>;

    /**
     * Unload the model and release resources.
     */
    unloadModel(): Promise<void>;

    /**
     * Check if a model is currently loaded.
     */
    isModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Extract speaker embedding from audio data.
     * @param options.audioData Base64-encoded audio data (16kHz, mono, 16-bit PCM)
     * @returns Embedding vector and dimension
     */
    extractEmbedding(options: { audioData: string }): Promise<EmbeddingResult>;

    /**
     * Get information about the loaded model.
     */
    getModelInfo(): Promise<ModelInfo>;

    /**
     * Remove all listeners for this plugin.
     */
    removeAllListeners(): Promise<void>;
}

/**
 * Result of embedding extraction.
 */
export interface EmbeddingResult {
    /** Speaker embedding vector (typically 192 or 512 dimensions) */
    embedding: number[];
    /** Dimension of the embedding vector */
    dimension: number;
}

/**
 * Information about the loaded model.
 */
export interface ModelInfo {
    /** Whether a model is loaded */
    loaded: boolean;
    /** Dimension of the embedding vectors produced */
    dimension: number;
}
