import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
    loadedDir: '' as string,
    loadModel: vi.fn(),
    generateEmbedding: vi.fn(),
}));

vi.mock('text-embedding-capacitor', () => ({
    TextEmbedding: {
        isModelLoaded: async () => ({ loaded: !!native.loadedDir, dimension: 384, modelId: native.loadedDir }),
        loadModel: native.loadModel,
        unloadModel: async () => { native.loadedDir = ''; },
        generateEmbedding: native.generateEmbedding,
    },
}));
vi.mock('../src/services/model/embedding/localModelService', () => ({
    validateEmbeddingModel: async (modelId: string) => modelId === 'missing'
        ? { exists: false, hasModel: false, hasTokenizer: false, path: `embedding_models/${modelId}`, error: 'Missing files: model.onnx' }
        : { exists: true, hasModel: true, hasTokenizer: true, path: `embedding_models/${modelId}` },
}));
vi.mock('../src/services/memory/embeddingReindexer', () => ({ scheduleEmbeddingReindex: vi.fn() }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/model/embedding/modelSources', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/services/model/embedding/modelSources')>();
    // config.json of the imported models: "memories3" is an E5, "notes" a MiniLM
    const configs: Record<string, string> = { memories3: 'intfloat/multilingual-e5-small', notes: 'sentence-transformers/all-MiniLM-L6-v2' };
    return { ...real, readModelSource: async (id: string) => configs[id] };
});

import {
    embedText, embeddingModelKey, ensureEmbeddingModel, ensureEmbeddingModelFromSettings, getActiveEmbeddingModel,
    getEmbeddingLoadError, getEmbeddingPrefixes, resetEmbeddingRuntimeForTests,
} from '../src/services/model/embedding/embeddingRuntime';
import { memoryThresholds } from '../src/services/memory/context/memoryThresholds';

describe('embedding runtime', () => {
    beforeEach(() => {
        resetEmbeddingRuntimeForTests();
        native.loadedDir = '';
        native.loadModel.mockReset().mockImplementation(async ({ modelDir }: { modelDir: string }) => {
            native.loadedDir = modelDir;
            return { dimension: 384 };
        });
        native.generateEmbedding.mockReset().mockImplementation(async ({ text }: { text: string }) => ({ embedding: [text.length, 1], dimension: 2 }));
    });

    it('loads the selected model once and reloads when the selection changes', async () => {
        expect(await ensureEmbeddingModel('all-MiniLM-L6-v2')).toBe(true);
        expect(await ensureEmbeddingModel('all-MiniLM-L6-v2')).toBe(true);
        expect(native.loadModel).toHaveBeenCalledTimes(1);
        expect(getActiveEmbeddingModel()?.key).toBe(embeddingModelKey('all-MiniLM-L6-v2'));

        expect(await ensureEmbeddingModel('e5-small-v2')).toBe(true);
        expect(native.loadModel).toHaveBeenCalledTimes(2);
        expect(native.loadModel).toHaveBeenLastCalledWith({ modelDir: 'embedding_models/e5-small-v2' });
        expect(getActiveEmbeddingModel()?.modelId).toBe('e5-small-v2');
    });

    it('adopts a model the native side still holds instead of loading it again', async () => {
        native.loadedDir = 'embedding_models/bge-small-en-v1.5';
        expect(await ensureEmbeddingModel('bge-small-en-v1.5')).toBe(true);
        expect(native.loadModel).not.toHaveBeenCalled();
    });

    it('serializes concurrent loads (one native session per model)', async () => {
        const results = await Promise.all([ensureEmbeddingModel('a'), ensureEmbeddingModel('a'), ensureEmbeddingModel('a')]);
        expect(results).toEqual([true, true, true]);
        expect(native.loadModel).toHaveBeenCalledTimes(1);
    });

    it('reports a failed load and does not retry it on every message', async () => {
        native.loadModel.mockRejectedValue(new Error('Unsupported tokenizer type: BPE'));
        expect(await ensureEmbeddingModel('broken')).toBe(false);
        expect(getEmbeddingLoadError('broken')).toContain('Unsupported tokenizer');
        expect(await ensureEmbeddingModel('broken')).toBe(false);
        expect(native.loadModel).toHaveBeenCalledTimes(1);
        await ensureEmbeddingModel('broken', { force: true });
        expect(native.loadModel).toHaveBeenCalledTimes(2);

        expect(await ensureEmbeddingModel('missing')).toBe(false);
        expect(getEmbeddingLoadError('missing')).toContain('Missing files');
    });

    it('applies E5 prefixes for queries and stored passages', async () => {
        expect(getEmbeddingPrefixes('multilingual-e5-small')).toEqual({ query: 'query: ', passage: 'passage: ' });
        expect(getEmbeddingPrefixes('my-imported-e5-base')).toEqual({ query: 'query: ', passage: 'passage: ' });
        expect(getEmbeddingPrefixes('all-MiniLM-L6-v2')).toEqual({ query: '', passage: '' });

        await ensureEmbeddingModel('e5-small-v2');
        const { key } = await embedText('hello', 'passage');
        expect(native.generateEmbedding).toHaveBeenLastCalledWith({ text: 'passage: hello' });
        expect(key).toBe(embeddingModelKey('e5-small-v2'));
        await embedText('hello', 'query');
        expect(native.generateEmbedding).toHaveBeenLastCalledWith({ text: 'query: hello' });
    });

    it('recognizes an imported E5 by its config: prefixes, a key of its own, E5 thresholds', async () => {
        await ensureEmbeddingModel('memories3');
        const { key } = await embedText('dove abito', 'query');
        expect(native.generateEmbedding).toHaveBeenLastCalledWith({ text: 'query: dove abito' });
        expect(key).toBe(`${embeddingModelKey('memories3')}-e5`); // old vectors without prefixes get re-embedded
        expect(memoryThresholds({ embeddingModelId: 'memories3' }).related).toBe(memoryThresholds({ embeddingModelId: 'multilingual-e5-small' }).related);
        await ensureEmbeddingModel('notes');
        expect((await embedText('x', 'query')).key).toBe(embeddingModelKey('notes'));
        expect(native.generateEmbedding).toHaveBeenLastCalledWith({ text: 'x' });
    });

    it('refuses to embed without a model and reads the selected model from the settings', async () => {
        await expect(embedText('x', 'query')).rejects.toThrow('No embedding model loaded');
        localStorage.setItem('llm-config', JSON.stringify({ embeddingModelId: 'bge-small-en-v1.5' }));
        expect(await ensureEmbeddingModelFromSettings()).toBe(true);
        expect(getActiveEmbeddingModel()?.modelId).toBe('bge-small-en-v1.5');
    });
});
