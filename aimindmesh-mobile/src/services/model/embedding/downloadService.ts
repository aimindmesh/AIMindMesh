import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../../logger';
import { EMBEDDING_MODELS, EMBEDDING_MODELS_DIR, EmbeddingDownloadProgress } from './types';
import { ensureModelsDir } from './localModelService';

/**
 * Helper to append binary buffer to file via base64
 */
async function appendBufferToFile(path: string, buffer: Uint8Array): Promise<void> {
    let binary = '';
    const len = buffer.byteLength;
    // Process in 32KB chunks to avoid stack overflow in String.fromCharCode
    for (let i = 0; i < len; i += 32768) {
        binary += String.fromCharCode(...buffer.subarray(i, Math.min(i + 32768, len)));
    }
    const base64Data = btoa(binary);

    await Filesystem.appendFile({
        path,
        data: base64Data,
        directory: Directory.Data
    });
}

/**
 * Download an embedding model (model.onnx + tokenizer.json)
 */
export async function downloadEmbeddingModel(
    modelId: string,
    onProgress?: (progress: EmbeddingDownloadProgress) => void
): Promise<string> {
    const modelDef = EMBEDDING_MODELS.find(m => m.id === modelId);
    if (!modelDef) {
        throw new Error(`Model definition not found for ID: ${modelId}`);
    }

    logger.log('info', `[EmbeddingDownloader] Starting download: ${modelId}`);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Embedding models can only be downloaded on native platforms');
    }

    await ensureModelsDir();
    const modelDir = `${EMBEDDING_MODELS_DIR}/${modelId}`;
    const modelPath = `${modelDir}/model.onnx`;
    const tokenizerPath = `${modelDir}/tokenizer.json`;

    try {
        // Create model directory
        try {
            await Filesystem.mkdir({
                path: modelDir,
                directory: Directory.Data,
                recursive: true
            });
        } catch {
            // May exist
        }

        // 1. Download model.onnx (Large file - use chunked streaming)
        if (onProgress) onProgress({
            bytesDownloaded: 0,
            totalBytes: modelDef.sizeBytes,
            percentage: 0,
            completed: false,
            failed: false,
            step: 'Downloading model geometry...'
        });

        // Delete existing model file if any
        try {
            await Filesystem.deleteFile({ path: modelPath, directory: Directory.Data });
        } catch { }

        // Create empty file
        await Filesystem.writeFile({
            path: modelPath,
            data: '',
            directory: Directory.Data
        });

        const response = await fetch(modelDef.modelUrl);
        if (!response.ok) throw new Error(`Failed to download model: ${response.statusText}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error('Failed to get response reader');

        let receivedBytes = 0;
        let buffer: Uint8Array = new Uint8Array(0);
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                if (buffer.length > 0) await appendBufferToFile(modelPath, buffer);
                break;
            }

            // Append to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            receivedBytes += value.length;

            if (buffer.length >= CHUNK_SIZE) {
                await appendBufferToFile(modelPath, buffer);
                buffer = new Uint8Array(0);
            }

            if (onProgress) {
                onProgress({
                    bytesDownloaded: receivedBytes,
                    totalBytes: modelDef.sizeBytes,
                    percentage: Math.round((receivedBytes / modelDef.sizeBytes) * 100),
                    completed: false,
                    failed: false,
                    step: 'Downloading model geometry...'
                });
            }
        }

        // 2. Download tokenizer.json (Small file - simple fetch)
        if (onProgress) onProgress({
            bytesDownloaded: receivedBytes,
            totalBytes: modelDef.sizeBytes,
            percentage: 99,
            completed: false,
            failed: false,
            step: 'Downloading tokenizer...'
        });

        const tokenizerResp = await fetch(modelDef.tokenizerUrl);
        if (!tokenizerResp.ok) throw new Error(`Failed to download tokenizer: ${tokenizerResp.statusText}`);
        const tokenizerJson = await tokenizerResp.text();

        await Filesystem.writeFile({
            path: tokenizerPath,
            data: tokenizerJson,
            directory: Directory.Data,
            encoding: Encoding.UTF8
        });

        // 3. Save config for dimension if needed (optional)
        const configPath = `${modelDir}/config.json`;
        await Filesystem.writeFile({
            path: configPath,
            data: JSON.stringify({ hidden_size: modelDef.dimension }),
            directory: Directory.Data,
            encoding: Encoding.UTF8
        });

        if (onProgress) {
            onProgress({
                bytesDownloaded: receivedBytes,
                totalBytes: modelDef.sizeBytes,
                percentage: 100,
                completed: true,
                failed: false,
                step: 'Complete'
            });
        }

        logger.log('info', `[EmbeddingDownloader] Download complete: ${modelId}`);
        return modelId;

    } catch (error) {
        logger.log('error', `[EmbeddingDownloader] Download failed: ${(error as any).message}`);

        // Cleanup
        try {
            await Filesystem.rmdir({ path: modelDir, directory: Directory.Data, recursive: true });
        } catch { }

        if (onProgress) {
            onProgress({
                bytesDownloaded: 0,
                totalBytes: 0,
                percentage: 0,
                completed: false,
                failed: true,
                errorMessage: (error as any).message
            });
        }
        throw error;
    }
}
