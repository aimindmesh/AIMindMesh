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
    /** Shipped in the APK (unpacked at first launch): it can't be deleted */
    bundled?: boolean;
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
        description: 'Fastest, for real-time voice chat on low-end devices',
        size: '74 MB',
        sizeBytes: 77691713,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-base-q8_0',
        name: 'Whisper Base (q8_0)',
        description: 'Bundled. Fast; fine on clear close-up speech, poor in noisy rooms (~28% word errors in Italian)',
        size: '82 MB',
        sizeBytes: 81768585,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin',
        languages: ['multilingual'],
        recommended: false,
        bundled: true,
    },
    {
        id: 'ggml-base',
        name: 'Whisper Base',
        description: 'Same text as Base q8_0, about 3x slower',
        size: '141 MB',
        sizeBytes: 147951465,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-small-q8_0',
        name: 'Whisper Small (q8_0)',
        description: 'Recommended for meetings: ~16% word errors in Italian, about as fast as Base on meeting turns',
        size: '264 MB',
        sizeBytes: 264464607,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
        languages: ['multilingual'],
        recommended: true,
    },
    {
        id: 'ggml-small-q5_1',
        name: 'Whisper Small (q5_1)',
        description: 'Smaller Small: close to q8_0 accuracy',
        size: '181 MB',
        sizeBytes: 190085487,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-small',
        name: 'Whisper Small',
        description: 'Same text as Small q8_0, slower',
        size: '465 MB',
        sizeBytes: 487601967,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-large-v3-turbo-q8_0',
        name: 'Whisper Large v3 Turbo (q8_0)',
        description: 'Near-perfect (~1% word errors) but slower than real time: choose it explicitly for short or important meetings',
        size: '834 MB',
        sizeBytes: 874188075,
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin',
        languages: ['multilingual'],
        recommended: false,
    },
    {
        id: 'ggml-medium',
        name: 'Whisper Medium',
        description: 'Best accuracy of the classic models, requires a lot of RAM',
        size: '1.4 GB',
        sizeBytes: 1533763059,
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
        await Filesystem.mkdir({ path: MODELS_DIR, directory: Directory.Data, recursive: true }).catch(() => { /* already there */ });

        // Native download (no copy of the file through the WebView): written to a .part file and
        // renamed when complete, so an interrupted download never looks like an installed model
        const { downloadModel } = await import('../model/modelDownloader');
        await downloadModel(model.url, targetPath, p => onProgress?.({
            bytesDownloaded: p.bytesDownloaded,
            totalBytes: p.totalBytes || model.sizeBytes,
            percentage: p.percentage,
            completed: false,
            failed: false
        }));

        const stat = await Filesystem.stat({ path: targetPath, directory: Directory.Data });
        if (model.sizeBytes > 0 && stat.size !== model.sizeBytes) {
            throw new Error(`Incomplete download: ${stat.size} of ${model.sizeBytes} bytes`);
        }

        onProgress?.({ bytesDownloaded: stat.size, totalBytes: stat.size, percentage: 100, completed: true, failed: false });
        logger.log('info', `[WhisperDownloader] Download complete: ${model.id}`);
        return targetPath;

    } catch (error) {
        logger.log('error', `[WhisperDownloader] Download failed: ${(error as any).message}`);
        await Filesystem.deleteFile({ path: targetPath, directory: Directory.Data }).catch(() => { });
        onProgress?.({
            bytesDownloaded: 0,
            totalBytes: model.sizeBytes,
            percentage: 0,
            completed: false,
            failed: true,
            errorMessage: (error as any).message
        });
        throw error;
    }
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
