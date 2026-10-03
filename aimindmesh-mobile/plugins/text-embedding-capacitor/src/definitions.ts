// Text Embedding Plugin - ONNX sentence embedding extraction
// Supports models like all-MiniLM-L6-v2 with configurable tokenizer

/**
 * Result of embedding extraction.
 */
export interface EmbeddingResult {
    /** Text embedding vector (typically 384 dimensions for MiniLM) */
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
    /** Directory of the loaded model as passed to loadModel ('' when none) */
    modelId: string;
}

/**
 * Configuration read from config.json in model directory
 */
export interface ModelConfig {
    /** Expected embedding dimension */
    hidden_size?: number;
    /** Maximum sequence length */
    max_position_embeddings?: number;
}

export interface TextEmbeddingPlugin {
    /**
     * Load an ONNX embedding model from a directory, replacing (and closing) the loaded one.
     * A no-op when this directory is already loaded; on failure the previous model stays.
     * Directory must contain: model.onnx, tokenizer.json (WordPiece or Unigram);
     * config.json and tokenizer_config.json are optional
     * @param options.modelDir Path to model directory (relative to app data)
     */
    loadModel(options: { modelDir: string }): Promise<{ dimension: number }>;

    /**
     * Unload the model and release resources.
     */
    unloadModel(): Promise<void>;

    /**
     * Check if a model is currently loaded.
     */
    isModelLoaded(): Promise<ModelInfo>;

    /**
     * Generate text embedding from input text.
     * Text is tokenized and passed through the ONNX model.
     * @param options.text Input text to embed
     * @returns Embedding vector and dimension
     */
    generateEmbedding(options: { text: string }): Promise<EmbeddingResult>;

    /**
     * Generate embeddings for multiple texts in a batch.
     * More efficient than calling generateEmbedding multiple times.
     * @param options.texts Array of input texts to embed
     * @returns Array of embedding results
     */
    generateEmbeddingBatch(options: { texts: string[] }): Promise<{ embeddings: EmbeddingResult[] }>;

    /**
     * Import a model from a ZIP file.
     * Handles content:// URIs, copies to app storage, and extracts.
     * ZIP must contain: model.onnx, tokenizer.json, config.json
     * @param options.sourcePath Source file path (can be content:// URI)
     * @param options.modelId ID for the imported model
     * @returns Path to extracted model directory
     */
    importModelZip(options: { sourcePath: string; modelId: string }): Promise<{ path: string; modelId: string }>;

    /**
     * Remove all listeners for this plugin.
     */
    removeAllListeners(): Promise<void>;
}
