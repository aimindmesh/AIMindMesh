import React, { useState, useEffect } from 'react';
import { LLMConfig } from '../../../types';

interface EmbeddingModelSectionProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
}

export const EmbeddingModelSection: React.FC<EmbeddingModelSectionProps> = ({
    llmConfig,
    onLlmConfigSave
}) => {
    const [embeddingModels, setEmbeddingModels] = useState<Array<{ id: string; name: string; dimension: number }>>([]);
    const [isImportingEmbedding, setIsImportingEmbedding] = useState(false);
    const [embeddingModelStatus, setEmbeddingModelStatus] = useState<{
        loaded: boolean;
        dimension: number;
        error?: string;
        modelId?: string;
    }>({ loaded: false, dimension: 0 });

    useEffect(() => {
        checkEmbeddingModels();
        if (llmConfig.enableSemanticMemory && llmConfig.embeddingModelId) {
            checkEmbeddingModelStatus();
        }
    }, [llmConfig.enableSemanticMemory, llmConfig.embeddingModelId]);

    const checkEmbeddingModels = async () => {
        try {
            const { listLocalEmbeddingModels } = await import('../../../services/model/embeddingModelDownloader');
            const embedModels = await listLocalEmbeddingModels();
            setEmbeddingModels(embedModels);
        } catch (e) {
            console.error('Failed to list embedding models', e);
        }
    };

    const checkEmbeddingModelStatus = async () => {
        try {
            const { TextEmbedding } = await import('text-embedding-capacitor');
            // Try to perform a dummy embedding to check if model is loaded
            const result = await TextEmbedding.generateEmbedding({
                text: 'test'
            }).catch((e: any) => ({ error: e }));

            if ((result as any).embedding) {
                setEmbeddingModelStatus({
                    loaded: true,
                    dimension: (result as any).embedding.length,
                    modelId: llmConfig.embeddingModelId
                });
            } else {
                // Model not loaded yet - this is normal before first message
                // Check if it's a "not initialized" vs actual error
                const errorMsg = (result as any).error?.message || '';
                const isNotInitialized = errorMsg.toLowerCase().includes('not initialized') ||
                    errorMsg.toLowerCase().includes('not loaded') ||
                    errorMsg.toLowerCase().includes('no model');
                setEmbeddingModelStatus({
                    loaded: false,
                    dimension: 0,
                    error: isNotInitialized ? undefined : errorMsg, // Don't show error for lazy loading
                    modelId: llmConfig.embeddingModelId
                });
            }
        } catch (e) {
            // Check if it's a lazy loading situation
            const errorMsg = (e as any).message || '';
            const isNotInitialized = errorMsg.toLowerCase().includes('not initialized') ||
                errorMsg.toLowerCase().includes('not loaded');
            setEmbeddingModelStatus({
                loaded: false,
                dimension: 0,
                error: isNotInitialized ? undefined : errorMsg
            });
        }
    };

    return (
        <div className="space-y-3 pt-3 border-t border-white/10">
            {/* Model Status Indicator */}
            {llmConfig.embeddingModelId && (
                <div className="mb-2 p-2 rounded bg-surface/20">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-secondary">Model Status:</span>
                        {embeddingModelStatus.loaded ? (
                            <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                                ✓ Loaded ({embeddingModelStatus.dimension}d)
                            </span>
                        ) : embeddingModelStatus.error ? (
                            <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                                ✗ Error
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                                ⏳ Waiting (loads on first use)
                            </span>
                        )}
                        <button
                            onClick={() => checkEmbeddingModelStatus()}
                            className="text-[10px] text-purple-400 hover:underline ml-2"
                        >
                            Check
                        </button>
                    </div>
                    {embeddingModelStatus.error && (
                        <p className="text-[9px] text-red-400 mt-1">{embeddingModelStatus.error}</p>
                    )}
                </div>
            )}

            {/* Model Selection */}
            <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Embedding Model</label>
                {embeddingModels.length > 0 ? (
                    <select
                        value={llmConfig.embeddingModelId || ''}
                        onChange={(e) => {
                            onLlmConfigSave({ ...llmConfig, embeddingModelId: e.target.value });
                            // Trigger check after a short delay
                            setTimeout(checkEmbeddingModelStatus, 500);
                        }}
                        className="w-full bg-input border-surface rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                        <option value="">Select model...</option>
                        {embeddingModels.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.name} ({m.dimension}d)
                            </option>
                        ))}
                    </select>
                ) : (
                    <p className="text-xs text-yellow-400 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">
                        ⚠️ No model installed. Import a model to enable semantic search.
                    </p>
                )}
            </div>

            {/* Import Button - Import ZIP using native plugin */}
            <button
                onClick={async () => {
                    setIsImportingEmbedding(true);
                    try {
                        const { FilePicker } = await import('@capawesome/capacitor-file-picker');

                        // Pick ZIP file
                        const result = await FilePicker.pickFiles({
                            types: ['application/zip'],
                            readData: false, // Don't load into memory
                        });

                        if (result.files.length === 0) {
                            throw new Error('No file selected');
                        }

                        const file = result.files[0];
                        if (!file.path) {
                            throw new Error('Unable to access file');
                        }

                        // Generate model ID from filename
                        const modelId = (file.name || 'embedding-model')
                            .replace(/\.zip$/i, '')
                            .replace(/[^a-zA-Z0-9-_]/g, '-')
                            .toLowerCase();

                        // Use native plugin to import and extract
                        const { TextEmbedding } = await import('text-embedding-capacitor');
                        await TextEmbedding.importModelZip({
                            sourcePath: file.path,
                            modelId: modelId,
                        });

                        // Refresh models list
                        const { listLocalEmbeddingModels } = await import('../../../services/model/embeddingModelDownloader');
                        const models = await listLocalEmbeddingModels();
                        setEmbeddingModels(models);
                        alert('Model imported successfully!');

                        // Update config if not set
                        if (!llmConfig.embeddingModelId) {
                            onLlmConfigSave({ ...llmConfig, embeddingModelId: modelId });
                        }

                        // Check status
                        checkEmbeddingModelStatus();
                    } catch (e) {
                        console.error('Failed to import embedding model', e);
                        alert('Import error: ' + (e as any).message);
                    } finally {
                        setIsImportingEmbedding(false);
                    }
                }}
                disabled={isImportingEmbedding}
                className={`w-full py-2 px-4 rounded-lg text-text-primary font-medium transition-colors flex items-center justify-center gap-2 ${isImportingEmbedding ? 'bg-surface/50 cursor-not-allowed' : 'bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50'}`}
            >
                {isImportingEmbedding ? 'Importing...' : '📦 Import Model (.zip)'}
            </button>

            <p className="text-[10px] text-text-secondary/60">
                💡 ZIP must contain: model.onnx, tokenizer.json, config.json.
                <br />
                Download: <a href="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2" target="_blank" className="text-purple-400 hover:underline">all-MiniLM-L6-v2</a> → Files → ONNX
            </p>

            {/* Similarity Threshold */}
            <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                    Similarity Threshold: {((llmConfig.semanticMemorySimilarityThreshold || 0.75) * 100).toFixed(0)}%
                </label>
                <input
                    type="range"
                    min="0.5"
                    max="0.95"
                    step="0.05"
                    value={llmConfig.semanticMemorySimilarityThreshold || 0.75}
                    onChange={(e) => onLlmConfigSave({ ...llmConfig, semanticMemorySimilarityThreshold: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
            </div>
        </div>
    );
};
