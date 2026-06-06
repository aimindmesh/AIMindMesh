import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';

/**
 * VAD Model Definition
 */
export interface VADModel {
    id: string;
    name: string;
    description: string;
    size: string;
    sizeBytes: number;
    url: string;
    sampleRate: number;
    recommended: boolean;
}

/**
 * Download progress for model downloads
 */
export interface VADDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
}

/**
 * Available Silero VAD models for download
 * Models from snakers4/silero-vad repository
 */
export const VAD_MODELS: VADModel[] = [
    {
        id: 'silero-vad-v4',
        name: 'Silero VAD v4 (16kHz)',
        description: 'Enterprise-grade VAD, optimized for 16kHz audio',
        size: '2 MB',
        sizeBytes: 2097152,
        url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
        sampleRate: 16000,
        recommended: true,
    },
    {
        id: 'silero-vad-v4-8k',
        name: 'Silero VAD v4 (8kHz)',
        description: 'Optimized for telephony/low-bandwidth audio',
        size: '2 MB',
        sizeBytes: 2097152,
        url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
        sampleRate: 8000,
        recommended: false,
    },
];

const MODELS_DIR = 'vad-models';

/**
 * Download a VAD model
 * @param model The model to download
 * @param onProgress Progress callback
 * @returns Path to the downloaded model
 */
export async function downloadVADModel(
    model: VADModel,
    onProgress?: (progress: VADDownloadProgress) => void
): Promise<string> {
    logger.log('info', `[VADDownloader] Starting download: ${model.id}`);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('VAD models can only be downloaded on native platforms');
    }

    const targetPath = `${MODELS_DIR}/${model.id}.onnx`;

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

        logger.log('info', `[VADDownloader] Download complete: ${model.id}`);
        return targetPath;

    } catch (error) {
        logger.log('error', `[VADDownloader] Download failed: ${(error as any).message}`);

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
 * Delete a VAD model
 */
export async function deleteVADModel(modelId: string): Promise<void> {
    logger.log('info', `[VADDownloader] Deleting model: ${modelId}`);

    try {
        const filePath = `${MODELS_DIR}/${modelId}.onnx`;
        await Filesystem.deleteFile({
            path: filePath,
            directory: Directory.Data
        });
        logger.log('info', `[VADDownloader] Model deleted: ${modelId}`);
    } catch (error) {
        logger.log('error', `[VADDownloader] Error deleting model: ${(error as any).message}`);
        throw error;
    }
}

/**
 * Check if a VAD model exists locally
 */
export async function vadModelExists(modelId: string): Promise<boolean> {
    try {
        const filePath = `${MODELS_DIR}/${modelId}.onnx`;
        await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * List all locally available VAD models
 */
export async function listLocalVADModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: MODELS_DIR,
            directory: Directory.Data
        });

        return result.files
            .filter(file => file.type === 'file' && file.name.endsWith('.onnx'))
            .map(file => file.name.replace('.onnx', ''));
    } catch {
        return [];
    }
}

/**
 * Get the full path to a VAD model for native plugin
 */
export async function getVADModelPath(modelId: string): Promise<string | null> {
    try {
        const filePath = `${MODELS_DIR}/${modelId}.onnx`;
        const stat = await Filesystem.stat({
            path: filePath,
            directory: Directory.Data
        });
        return stat.uri;
    } catch {
        return null;
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
 * Import a VAD model from a .onnx file
 */
export async function importVADModel(sourcePath: string, fileName?: string): Promise<string> {
    logger.log('info', `[VADDownloader] Importing model from: ${sourcePath}`);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('VAD models can only be imported on native platforms');
    }

    try {
        // @ts-ignore
        const { VAD } = await import('vad-capacitor');

        let targetFileName: string;

        if (fileName) {
            targetFileName = fileName;
        } else {
            // Extract filename from path
            targetFileName = sourcePath.split('/').pop() || 'imported-model.onnx';
        }

        // Ensure it ends with .onnx
        if (!targetFileName.endsWith('.onnx')) {
            if (!targetFileName.includes('.')) {
                targetFileName += '.onnx';
            }
        }

        // We will store it in vad-models directory
        const targetPath = `${MODELS_DIR}/${targetFileName}`;

        const result = await VAD.copyFile({
            sourcePath: sourcePath,
            fileName: targetPath
        });

        logger.log('info', `[VADDownloader] Model imported successfully: ${result.path}`);
        return result.path;
    } catch (error) {
        logger.log('error', `[VADDownloader] Import failed: ${(error as any).message}`);
        throw new Error(`Failed to import model: ${(error as any).message}`);
    }
}
