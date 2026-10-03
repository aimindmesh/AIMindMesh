import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

/**
 * Whisper Model Definition
 */
export interface WhisperModel {
    id: string;
    name: string;
    description: string;
    size: string;
    sizeBytes: number;
    url: string;
    languages: string[];
    recommended: boolean;
}

/**
 * Download progress for model downloads
 */
export interface ModelDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
}

/**
 * Available Whisper GGML models for download
 * All models are from ggerganov/whisper.cpp repository
 */
export const WHISPER_MODELS: WhisperModel[] = [
    {
        id: 'ggml-tiny',
        name: 'Whisper Tiny',
        description: 'Fastest, for real-time on low-end devices',
        size: '75 MB',
        sizeBytes: 78643200,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-base',
        name: 'Whisper Base',
        description: 'Balanced speed and accuracy',
        size: '142 MB',
        sizeBytes: 148897792,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        languages: ['multilingual'],
        recommended: true,
    },
    {
        id: 'ggml-small',
        name: 'Whisper Small',
        description: 'High accuracy, slower',
        size: '466 MB',
        sizeBytes: 488636416,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-medium',
        name: 'Whisper Medium',
        description: 'Best accuracy, requires 16GB+ RAM',
        size: '1.5 GB',
        sizeBytes: 1610612736,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
        languages: ['multilingual'],
        recommended: false,
    },
];

const MODELS_DIR = 'whisper-models';

/**
 * Download a Whisper model
 * @param model The model to download
 * @param onProgress Progress callback
 * @returns Path to the downloaded model
 */
export async function downloadWhisperModel(
    model: WhisperModel,
    onProgress?: (progress: ModelDownloadProgress) => void
): Promise<string> {
    logger.log('info', `[WhisperDownloader] Starting download: ${model.id}`);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Whisper models can only be downloaded on native platforms');
    }

    const targetPath = `${MODELS_DIR}/${model.id}.bin`;

    try {
        // Ensure directory exists
        try {
            await Filesystem.mkdir({
                path: MODELS_DIR,
                directory: Directory.Data,
                recursive: true
            });
        } catch {
            // Directory may already exist
        }

        // Delete existing file if any
        try {
            await Filesystem.deleteFile({
                path: targetPath,
                directory: Directory.Data
            });
        } catch {
            // File doesn't exist, ignore
        }

        // Create empty file
        await Filesystem.writeFile({
            path: targetPath,
            data: '',
            directory: Directory.Data
        });

        // Download using fetch with progress tracking
        const response = await fetch(model.url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = Number(response.headers.get('content-length')) || model.sizeBytes;
        const reader = response.body?.getReader();

        if (!reader) {
            throw new Error('Failed to get response reader');
        }

        let receivedBytes = 0;
        let buffer: Uint8Array = new Uint8Array(0);
        const CHUNK_SIZE = 5 * 1024 * 1024; // Write every 5MB

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                // Write remaining buffer
                if (buffer.length > 0) {
                    await appendBufferToFile(targetPath, buffer);
                }
                break;
            }

            // Append new value to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            receivedBytes += value.length;

            // Write chunk if buffer is large enough
            if (buffer.length >= CHUNK_SIZE) {
                await appendBufferToFile(targetPath, buffer);
                buffer = new Uint8Array(0); // Clear buffer
            }

            if (onProgress) {
                onProgress({
                    bytesDownloaded: receivedBytes,
                    totalBytes: contentLength,
                    percentage: Math.round((receivedBytes / contentLength) * 100),
                    completed: false,
                    failed: false
                });
            }
        }

        if (onProgress) {
            onProgress({
                bytesDownloaded: receivedBytes,
                totalBytes: contentLength,
                percentage: 100,
                completed: true,
                failed: false
            });
        }

        logger.log('info', `[WhisperDownloader] Download complete: ${model.id}`);
        return targetPath;

    } catch (error) {
        logger.log('error', `[WhisperDownloader] Download failed: ${(error as any).message}`);

        // Try to clean up partial file
        try {
            await Filesystem.deleteFile({
                path: targetPath,
                directory: Directory.Data
            });
        } catch { }

        if (onProgress) {
            onProgress({
                bytesDownloaded: 0,
                totalBytes: model.sizeBytes,
                percentage: 0,
                completed: false,
                failed: true,
                errorMessage: (error as any).message
            });
        }

        throw error;
    }
}

/**
 * Helper to append binary buffer to file via base64
 */
async function appendBufferToFile(path: string, buffer: Uint8Array): Promise<void> {
    // Convert buffer to base64
    // Use a chunked approach for btoa to avoid stack overflow on large buffers
    let binary = '';
    const len = buffer.byteLength;
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
 * Delete a Whisper model
 */
export async function deleteWhisperModel(modelId: string): Promise<void> {
    logger.log('info', `[WhisperDownloader] Deleting model: ${modelId}`);

    let deleted = false;
    try {
        const filePath = `${MODELS_DIR}/${modelId}.bin`;
        await Filesystem.deleteFile({
            path: filePath,
            directory: Directory.Data
        });
        deleted = true;
    } catch {
        // May be a directory model bundle
    }

    try {
        const dirPath = `${MODELS_DIR}/${modelId}`;
        await Filesystem.rmdir({
            path: dirPath,
            directory: Directory.Data,
            recursive: true
        });
        deleted = true;
    } catch {
        // Ignore if not a directory
    }

    if (deleted) {
        logger.log('info', `[WhisperDownloader] Model deleted: ${modelId}`);
    } else {
        logger.log('warn', `[WhisperDownloader] Model file or directory not found for deletion: ${modelId}`);
    }
}

/**
 * Check if a Whisper model exists locally
 */
export async function whisperModelExists(modelId: string): Promise<boolean> {
    try {
        const filePath = `${MODELS_DIR}/${modelId}.bin`;
        await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
        });
        return true;
    } catch {
        try {
            const dirPath = `${MODELS_DIR}/${modelId}`;
            const stat = await Filesystem.stat({
                path: dirPath,
                directory: Directory.Data
            });
            return !!stat;
        } catch {
            return false;
        }
    }
}

/**
 * Relative path (under Directory.Data) the native plugin should load for a model id: the
 * standalone `<id>.bin`, or the `<id>` directory of an imported ZIP bundle (the plugin finds
 * the binary inside it). Bundles are listed as model ids, so always appending `.bin` made them
 * impossible to load. Null when neither exists.
 */
export async function resolveWhisperModelRelativePath(modelId: string): Promise<string | null> {
    const binPath = `${MODELS_DIR}/${modelId}.bin`;
    try {
        await Filesystem.stat({ path: binPath, directory: Directory.Data });
        return binPath;
    } catch {
        // Not a standalone binary, try a bundle directory
    }
    const dirPath = `${MODELS_DIR}/${modelId}`;
    try {
        const stat = await Filesystem.stat({ path: dirPath, directory: Directory.Data });
        return stat.type === 'directory' ? dirPath : null;
    } catch {
        return null;
    }
}

/**
 * List all locally available Whisper models (both standalone .bin and unpacked directory bundles)
 */
export async function listLocalWhisperModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: MODELS_DIR,
            directory: Directory.Data
        });

        const models: string[] = [];
        for (const file of result.files) {
            if (file.type === 'file' && file.name.endsWith('.bin')) {
                models.push(file.name.replace('.bin', ''));
            } else if (file.type === 'directory') {
                models.push(file.name);
            }
        }
        return models;
    } catch {
        return [];
    }
}

/**
 * Get the full path to a Whisper model for native plugin
 */
export async function getWhisperModelPath(modelId: string): Promise<string | null> {
    try {
        const filePath = `${MODELS_DIR}/${modelId}.bin`;
        const stat = await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
        });
        return stat.uri;
    } catch {
        try {
            const dirPath = `${MODELS_DIR}/${modelId}`;
            const stat = await Filesystem.stat({
                path: dirPath,
                directory: Directory.Data
            });
            return stat.uri;
        } catch {
            return null;
        }
    }
}

/**
 * Validate a downloaded Whisper model
 */
export async function validateWhisperModel(modelId: string): Promise<{
    exists: boolean;
    path?: string;
    sizeBytes?: number;
    error?: string;
}> {
    try {
        const filePath = `${MODELS_DIR}/${modelId}.bin`;
        const stat = await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
        });

        return {
            exists: true,
            path: stat.uri,
            sizeBytes: stat.size
        };
    } catch {
        try {
            const dirPath = `${MODELS_DIR}/${modelId}`;
            const stat = await Filesystem.stat({
                path: dirPath,
                directory: Directory.Data
            });

            return {
                exists: true,
                path: stat.uri,
                sizeBytes: stat.size
            };
        } catch (error) {
            return {
                exists: false,
                error: (error as any).message
            };
        }
    }
}

/**
 * Get formatted file size
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Import a Whisper model from a .bin or .zip file in device storage
 */
export async function importWhisperModel(sourcePath: string, fileName?: string): Promise<string> {
    logger.log('info', `[WhisperDownloader] Importing model from: ${sourcePath}`);

    // On Desktop, we avoid copying and just return the source path
    if (isDesktop()) {
        logger.log('info', `[WhisperDownloader] Desktop detected, using direct path: ${sourcePath}`);
        return sourcePath;
    }

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Whisper models can only be imported on native platforms');
    }

    try {
        const { Whisper } = await import('whisper-capacitor');

        let targetFileName: string;

        if (fileName) {
            targetFileName = fileName;
        } else {
            // Extract filename from path
            targetFileName = sourcePath.split('/').pop() || 'imported-model.bin';
        }

        const isZip = targetFileName.toLowerCase().endsWith('.zip') || sourcePath.toLowerCase().endsWith('.zip');

        if (!isZip && !targetFileName.endsWith('.bin')) {
            if (!targetFileName.includes('.')) {
                targetFileName += '.bin';
            }
        }

        // We will store it in whisper-models directory
        // The Plugin's copyFile method expects fileName relative to FilesDir
        const targetPath = `${MODELS_DIR}/${targetFileName}`;

        const result = await Whisper.copyFile({
            sourcePath: sourcePath,
            fileName: targetPath
        });

        logger.log('info', `[WhisperDownloader] Model imported successfully: ${result.path}`);
        return result.path;
    } catch (error) {
        logger.log('error', `[WhisperDownloader] Import failed: ${(error as any).message}`);
        throw new Error(`Failed to import model: ${(error as any).message}`);
    }
}
