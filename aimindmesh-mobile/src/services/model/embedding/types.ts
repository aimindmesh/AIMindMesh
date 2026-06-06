export interface EmbeddingModelInfo {
    id: string;
    name: string;
    dimension: number;
    size: number;
    isImported: boolean;
    path: string;
}

export interface EmbeddingDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
    step?: string; // e.g. "Downloading model", "Downloading tokenizer"
}

export const EMBEDDING_MODELS_DIR = 'embedding_models';

// Predefined embedding models with direct download URLs
export const EMBEDDING_MODELS = [
    // Legacy model (keep for backwards compatibility)
    {
        id: 'all-MiniLM-L6-v2',
        name: 'MiniLM L6 v2 (Legacy)',
        description: 'Original model, good for prototyping',
        dimension: 384,
        size: 22_000_000, // ~22MB
        sizeBytes: 23068672,
        modelUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
        tokenizerUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
        recommended: false,
    },
    // E5 Models (Microsoft)
    {
        id: 'e5-small-v2',
        name: 'E5 Small v2 ⭐',
        description: '+5% accuracy vs MiniLM, same speed',
        dimension: 384,
        size: 33_000_000, // ~33MB
        sizeBytes: 34603008,
        modelUrl: 'https://huggingface.co/intfloat/e5-small-v2/resolve/main/onnx/model.onnx',
        tokenizerUrl: 'https://huggingface.co/intfloat/e5-small-v2/resolve/main/tokenizer.json',
        queryPrefix: 'query: ',  // E5 requires prefix
        passagePrefix: 'passage: ',
        recommended: true,
    },
    {
        id: 'multilingual-e5-small',
        name: 'E5 Small Multilingual',
        description: 'Best for Italian and multilingual content',
        dimension: 384,
        size: 117_000_000, // ~117MB
        sizeBytes: 122683392,
        modelUrl: 'https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/onnx/model.onnx',
        tokenizerUrl: 'https://huggingface.co/intfloat/multilingual-e5-small/resolve/main/tokenizer.json',
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        recommended: false,
    },
    // BGE Models (BAAI)
    {
        id: 'bge-small-en-v1.5',
        name: 'BGE Small EN v1.5',
        description: '+6% accuracy, optimized for English',
        dimension: 384,
        size: 33_000_000, // ~33MB
        sizeBytes: 34603008,
        modelUrl: 'https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx',
        tokenizerUrl: 'https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer.json',
        recommended: false,
    },
    {
        id: 'bge-base-en-v1.5',
        name: 'BGE Base EN v1.5',
        description: '+8% accuracy, 768-dim, slower but best quality',
        dimension: 768,
        size: 110_000_000, // ~110MB
        sizeBytes: 115343360,
        modelUrl: 'https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/onnx/model.onnx',
        tokenizerUrl: 'https://huggingface.co/BAAI/bge-base-en-v1.5/resolve/main/tokenizer.json',
        recommended: false,
    },
];

export function formatModelSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
