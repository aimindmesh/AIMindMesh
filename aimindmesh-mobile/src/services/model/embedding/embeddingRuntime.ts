/**
 * Embedding runtime: which embedding model is loaded in the native TextEmbedding plugin,
 * loading the selected one, and embedding texts with the model's prefixes.
 *
 * Every stored vector is tagged with the key of the model that produced it (modelId plus the
 * pipeline version): vectors of different models are never compared, and rows with another
 * key are re-embedded in the background (memory/embeddingReindexer) after a model switch.
 */

import { TextEmbedding } from 'text-embedding-capacitor';
import { logger } from '../../logger';
import { EMBEDDING_MODELS, EMBEDDING_MODELS_DIR } from './types';
import { validateEmbeddingModel } from './localModelService';

/**
 * Bump when the native pipeline changes the vectors it produces (tokenizer, input length,
 * prefixes). v2: real WordPiece/Unigram tokenization, 512-token inputs, E5 prefixes.
 */
export const EMBEDDING_PIPELINE_VERSION = 2;
/** A model that failed to load is not retried on every message */
const LOAD_RETRY_MS = 60_000;
const EMBED_TIMEOUT_MS = 10_000;

export interface ActiveEmbeddingModel {
    modelId: string;
    /** Stored with each vector (embedding_model column) */
    key: string;
    dimension: number;
}

let active: ActiveEmbeddingModel | null = null;
let lastError: { modelId: string; message: string; at: number } | null = null;
let queue: Promise<unknown> = Promise.resolve();

export const embeddingModelKey = (modelId: string) => `${modelId}#v${EMBEDDING_PIPELINE_VERSION}`;
const modelDir = (modelId: string) => `${EMBEDDING_MODELS_DIR}/${modelId}`;

/** E5 models need "query: " / "passage: " prefixes; imported E5 models are recognized by name. */
export function getEmbeddingPrefixes(modelId: string): { query: string; passage: string } {
    const definition = EMBEDDING_MODELS.find(m => m.id === modelId);
    if (definition) return { query: definition.queryPrefix || '', passage: definition.passagePrefix || '' };
    return /(^|[^a-z0-9])e5([^a-z0-9]|$)/i.test(modelId)
        ? { query: 'query: ', passage: 'passage: ' }
        : { query: '', passage: '' };
}

export function getActiveEmbeddingModel(): ActiveEmbeddingModel | null {
    return active;
}

/** Last load error for the model (or any model), shown in the memory settings. */
export function getEmbeddingLoadError(modelId?: string): string | null {
    if (!lastError || (modelId && lastError.modelId !== modelId)) return null;
    return lastError.message;
}

/** Loads run one at a time, so the active model always matches the last completed load. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

/**
 * Make `modelId` the loaded model. Cheap when it already is; reloads when another model is
 * loaded (the user changed the selection). Returns false when the model cannot be loaded:
 * getEmbeddingLoadError() then says why.
 */
export function ensureEmbeddingModel(modelId: string | undefined, options: { force?: boolean } = {}): Promise<boolean> {
    if (!modelId) return Promise.resolve(false);
    if (active?.modelId === modelId) return Promise.resolve(true);
    return serialized(async () => {
        if (active?.modelId === modelId) return true;
        if (!options.force && lastError?.modelId === modelId && Date.now() - lastError.at < LOAD_RETRY_MS) return false;
        return loadModel(modelId);
    });
}

/**
 * The model selected in the settings (llm-config), for callers without the config at hand.
 * Documents use it even with semantic memory off.
 */
export function ensureEmbeddingModelFromSettings(): Promise<boolean> {
    let modelId: string | undefined;
    try {
        const raw = localStorage.getItem('llm-config');
        modelId = raw ? JSON.parse(raw)?.embeddingModelId : undefined;
    } catch {
        modelId = undefined;
    }
    return ensureEmbeddingModel(modelId);
}

async function loadModel(modelId: string): Promise<boolean> {
    try {
        // The native side may still hold this model (e.g. after a WebView reload)
        const status = await TextEmbedding.isModelLoaded().catch(() => null);
        if (status?.loaded && status.modelId === modelDir(modelId)) {
            activate(modelId, status.dimension);
            return true;
        }
        const validation = await validateEmbeddingModel(modelId);
        if (!validation.exists) throw new Error(validation.error || `Embedding model "${modelId}" not found`);
        const started = Date.now();
        const result = await TextEmbedding.loadModel({ modelDir: validation.path });
        logger.log('info', `[Embedding] Loaded "${modelId}" (${result.dimension}d) in ${Date.now() - started}ms`);
        activate(modelId, result.dimension);
        return true;
    } catch (error) {
        const message = (error as any)?.message || String(error);
        lastError = { modelId, message, at: Date.now() };
        // The native side keeps the previous model on a failed load, so `active` still describes it
        logger.log('error', `[Embedding] Failed to load "${modelId}": ${message}`);
        return false;
    }
}

function activate(modelId: string, dimension: number): void {
    active = { modelId, key: embeddingModelKey(modelId), dimension };
    if (lastError?.modelId === modelId) lastError = null;
    // Rows embedded by another model or pipeline version are re-embedded in the background
    import('../../memory/embeddingReindexer')
        .then(m => m.scheduleEmbeddingReindex())
        .catch(e => logger.log('warn', '[Embedding] Could not start re-indexing', e));
}

export async function unloadEmbeddingModel(): Promise<void> {
    await serialized(async () => {
        await TextEmbedding.unloadModel();
        active = null;
    });
}

/**
 * Embed a text with the active model: "query" for searches, "passage" for stored texts.
 * Returns the model key to store with the vector.
 */
export async function embedText(text: string, kind: 'query' | 'passage'): Promise<{ vector: Float32Array; key: string }> {
    const model = active;
    if (!model) throw new Error('No embedding model loaded');
    const prefix = getEmbeddingPrefixes(model.modelId)[kind];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            TextEmbedding.generateEmbedding({ text: prefix + text }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('TextEmbedding.generateEmbedding TIMEOUT')), EMBED_TIMEOUT_MS);
            }),
        ]);
        // A model switch completed meanwhile: the vector may come from either model
        if (active?.key !== model.key) throw new Error('Embedding model changed during the request');
        return { vector: new Float32Array(result.embedding), key: model.key };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Test hook: forget the runtime state. */
export function resetEmbeddingRuntimeForTests(): void {
    active = null;
    lastError = null;
    queue = Promise.resolve();
}
