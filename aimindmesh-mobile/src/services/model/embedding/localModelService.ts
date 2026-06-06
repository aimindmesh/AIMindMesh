import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../../utils/fileSystemAdapter';
import { logger } from '../../logger';
import { EmbeddingModelInfo, EMBEDDING_MODELS_DIR } from './types';

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
    try {
        await Filesystem.stat({
            path,
            directory: Directory.Data,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the base directory for embedding models
 */
export async function ensureModelsDir(): Promise<void> {
    try {
        await Filesystem.mkdir({
            path: EMBEDDING_MODELS_DIR,
            directory: Directory.Data,
            recursive: true,
        });
    } catch (e) {
        // Directory may already exist
    }
}

/**
 * List all locally available embedding models
 */
export async function listLocalEmbeddingModels(): Promise<EmbeddingModelInfo[]> {
    await ensureModelsDir();

    const models: EmbeddingModelInfo[] = [];

    try {
        const result = await Filesystem.readdir({
            path: EMBEDDING_MODELS_DIR,
            directory: Directory.Data,
        });

        for (const file of result.files) {
            if (file.type === 'directory') {
                const modelDir = `${EMBEDDING_MODELS_DIR}/${file.name}`;

                // Check if required files exist
                const hasModel = await fileExists(`${modelDir}/model.onnx`);
                const hasTokenizer = await fileExists(`${modelDir}/tokenizer.json`);

                if (hasModel && hasTokenizer) {
                    // Try to read config for dimension
                    let dimension = 384; // Default
                    try {
                        const configContent = await Filesystem.readFile({
                            path: `${modelDir}/config.json`,
                            directory: Directory.Data,
                            encoding: Encoding.UTF8,
                        });
                        const config = JSON.parse(configContent.data as string);
                        dimension = config.hidden_size || 384;
                    } catch (e) {
                        // Use default dimension
                    }

                    // Get directory size
                    let size = 0;
                    try {
                        const stat = await Filesystem.stat({
                            path: `${modelDir}/model.onnx`,
                            directory: Directory.Data,
                        });
                        size = stat.size || 0;
                    } catch (e) {
                        // Size unknown
                    }

                    models.push({
                        id: file.name,
                        name: file.name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                        dimension,
                        size,
                        isImported: true,
                        path: modelDir,
                    });
                }
            }
        }
    } catch (e) {
        logger.log('warn', 'Failed to list embedding models', e);
    }

    return models;
}

/**
 * Delete an embedding model
 */
export async function deleteEmbeddingModel(modelId: string): Promise<void> {
    const modelDir = `${EMBEDDING_MODELS_DIR}/${modelId}`;

    try {
        await Filesystem.rmdir({
            path: modelDir,
            directory: Directory.Data,
            recursive: true,
        });
        logger.log('info', `Deleted embedding model: ${modelId}`);
    } catch (e) {
        logger.log('error', `Failed to delete embedding model: ${modelId}`, e);
        throw e;
    }
}

/**
 * Check if an embedding model exists locally
 */
export async function embeddingModelExists(modelId: string): Promise<boolean> {
    const modelDir = `${EMBEDDING_MODELS_DIR}/${modelId}`;
    const hasModel = await fileExists(`${modelDir}/model.onnx`);
    const hasTokenizer = await fileExists(`${modelDir}/tokenizer.json`);
    return hasModel && hasTokenizer;
}

/**
 * Get the path to an embedding model directory
 * Logs the resolved path to help with debugging
 */
export function getEmbeddingModelPath(modelId: string): string {
    const path = `${EMBEDDING_MODELS_DIR}/${modelId}`;
    logger.log('info', `[Embedding] Resolved model path for ID "${modelId}": ${path}`);
    return path;
}

/**
 * Validate that an embedding model exists and has required files
 * Returns detailed status for UI display
 */
export async function validateEmbeddingModel(modelId: string): Promise<{
    exists: boolean;
    hasModel: boolean;
    hasTokenizer: boolean;
    path: string;
    error?: string;
}> {
    const modelDir = `${EMBEDDING_MODELS_DIR}/${modelId}`;

    logger.log('info', `[Embedding] Validating model "${modelId}" at ${modelDir}`);

    try {
        const hasModel = await fileExists(`${modelDir}/model.onnx`);
        const hasTokenizer = await fileExists(`${modelDir}/tokenizer.json`);

        const exists = hasModel && hasTokenizer;

        if (!exists) {
            const missing: string[] = [];
            if (!hasModel) missing.push('model.onnx');
            if (!hasTokenizer) missing.push('tokenizer.json');

            const error = `Missing files: ${missing.join(', ')}`;
            logger.log('warn', `[Embedding] Model validation failed: ${error}`);

            return {
                exists: false,
                hasModel,
                hasTokenizer,
                path: modelDir,
                error,
            };
        }

        logger.log('info', `[Embedding] Model "${modelId}" validated successfully`);

        return {
            exists: true,
            hasModel: true,
            hasTokenizer: true,
            path: modelDir,
        };
    } catch (e) {
        const error = `Validation error: ${(e as any).message}`;
        logger.log('error', `[Embedding] Failed to validate model "${modelId}"`, e);
        return {
            exists: false,
            hasModel: false,
            hasTokenizer: false,
            path: modelDir,
            error,
        };
    }
}
