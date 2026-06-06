import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

export interface VoskModel {
    id: string;
    name: string;
    language: 'en' | 'it';
    size: number;
    url: string;
    description: string;
    quality: 'small' | 'medium' | 'large';
}

export interface ModelDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
}

// Vosk models for English and Italian
export const VOSK_MODELS: VoskModel[] = [
    // English Models
    {
        id: 'vosk-model-en-us-0.22-lgraph',
        name: 'English (US) - Standard',
        language: 'en',
        size: 128000000, // ~128MB  
        url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip',
        description: 'Good balance of speed and accuracy',
        quality: 'medium'
    },
    {
        id: 'vosk-model-en-us-0.22',
        name: 'English (US) - High Precision',
        language: 'en',
        size: 1800000000, // ~1.8GB
        url: 'https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip',
        description: 'Maximum accuracy, requires more RAM',
        quality: 'large'
    },

    // Italian Models
    {
        id: 'vosk-model-it-0.22',
        name: 'Italiano - Standard',
        language: 'it',
        size: 128000000, // ~128MB
        url: 'https://alphacephei.com/vosk/models/vosk-model-it-0.22.zip',
        description: 'Buon bilanciamento velocità/accuratezza',
        quality: 'medium'
    },
];

// Speaker identification model (separate from ASR models)
export const VOSK_SPEAKER_MODEL = {
    id: 'vosk-model-spk-0.4',
    name: 'Speaker Model',
    size: 13000000, // ~13MB
    url: 'https://alphacephei.com/vosk/models/vosk-model-spk-0.4.zip',
    description: 'Modello per identificazione speaker nelle meeting'
};

// ONNX ECAPA models for high-accuracy speaker embedding
export const ONNX_SPEAKER_MODELS = [
    {
        id: 'wespeaker-voxceleb-ecapa-tdnn512',
        name: 'ECAPA-TDNN 512 (Standard)',
        size: 25000000, // ~25MB
        url: 'https://huggingface.co/Wespeaker/wespeaker-voxceleb-ecapa-tdnn512/resolve/main/voxceleb_ECAPA512.onnx?download=true',
        description: 'ECAPA-TDNN 512 - Buona precisione',
        dimension: 512
    },
    {
        id: 'wespeaker-ecapa-tdnn512-LM',
        name: 'ECAPA-TDNN 512 LM (Precisione Alta)',
        size: 45000000, // ~45MB
        url: 'https://huggingface.co/Wespeaker/wespeaker-ecapa-tdnn512-LM/resolve/main/voxceleb_ECAPA512_LM.onnx?download=true',
        description: 'ECAPA-TDNN con Large Margin - Massima precisione',
        dimension: 512
    },
    {
        id: 'wespeaker-voxceleb-resnet34-LM',
        name: 'ResNet34 LM (Alternativa)',
        size: 27000000, // ~27MB
        url: 'https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx?download=true',
        description: 'ResNet34 con Large Margin',
        dimension: 256
    }
];

/**
 * Download a Vosk model
 * Note: This is a placeholder. The actual download will be handled by a native plugin
 * once we create the custom Vosk Capacitor plugin.
 */
export async function downloadVoskModel(
    model: VoskModel,
    onProgress?: (progress: ModelDownloadProgress) => void
): Promise<string> {
    logger.log('debug', '[VoskDownloader] Starting download:', model.id);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Vosk models can only be downloaded on native platforms');
    }

    const { Vosk } = await import('vosk-capacitor');

    // Setup progress listener
    let progressListener: any;
    if (onProgress) {
        progressListener = await Vosk.addListener('downloadProgress', (data: { progress: number }) => {
            onProgress({
                bytesDownloaded: 0, // Not available from simple progress
                totalBytes: model.size,
                percentage: data.progress,
                completed: false,
                failed: false
            });
        });
    }

    try {
        const targetPath = `vosk-models/${model.id}.zip`;
        const result = await Vosk.downloadModel({
            url: model.url,
            path: targetPath
        });

        // The plugin now handles unzipping and returns the path to the model directory
        return result.path;
    } finally {
        if (progressListener) {
            progressListener.remove();
        }
    }
}

/**
 * Delete a local Vosk model
 */
export async function deleteVoskModel(modelId: string): Promise<void> {
    logger.log('debug', '[VoskDownloader] Deleting model:', modelId);

    try {
        const dirPath = `vosk-models/${modelId}`;
        await Filesystem.rmdir({
            path: dirPath,
            directory: Directory.Data,
            recursive: true
        });
    } catch (error) {
        logger.log('error', '[VoskDownloader] Error deleting model:', error);
        throw error;
    }
}

/**
 * Check if a Vosk model exists locally
 */
export async function voskModelExists(modelId: string): Promise<boolean> {
    try {
        const dirPath = `vosk-models/${modelId}`;
        await Filesystem.stat({
            path: dirPath,
            directory: Directory.Data
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * List all locally available Vosk models
 * Handles nested directories (e.g., vosk-models/dir/actual-model)
 */
export async function listLocalVoskModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: 'vosk-models',
            directory: Directory.Data
        });

        const models: string[] = [];

        // Check each item in vosk-models directory
        for (const file of result.files) {
            if (file.type === 'directory') {
                // Check if this directory contains a nested model directory
                try {
                    const subResult = await Filesystem.readdir({
                        path: `vosk-models/${file.name}`,
                        directory: Directory.Data
                    });

                    // If there's exactly one subdirectory, it's likely the actual model
                    const subDirs = subResult.files.filter(f => f.type === 'directory');
                    if (subDirs.length === 1) {
                        // This is a nested structure, use the nested path
                        models.push(`${file.name}/${subDirs[0].name}`);
                    } else {
                        // No nesting or multiple subdirs, use the directory name as-is
                        models.push(file.name);
                    }
                } catch {
                    // If we can't read subdirectory, just use the directory name
                    models.push(file.name);
                }
            }
        }

        return models;
    } catch {
        return [];
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
 * Import a Vosk model from a ZIP file in phone storage
 */


export async function importVoskModel(
    sourcePath: string,
    fileName?: string
): Promise<string> {
    logger.log('debug', '[VoskDownloader] Importing model from:', sourcePath);

    // On Desktop, we avoid copying and just return the source path
    if (isDesktop()) {
        logger.log('info', `[VoskDownloader] Desktop detected, using direct path: ${sourcePath}`);
        return sourcePath;
    }

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Vosk models can only be imported on native platforms');
    }

    try {
        let targetFileName: string;

        if (fileName) {
            targetFileName = fileName;
        } else {
            // Extract filename from path (fallback logic, unreliable for content:// URIs)
            const extractedName = sourcePath.split('/').pop() || 'imported-model.zip';
            if (!extractedName.toLowerCase().endsWith('.zip')) {
                logger.log('warn', '[VoskDownloader] Warning: Source might not be a zip, but proceeding:', extractedName);
            }
            targetFileName = extractedName;
        }

        const targetPath = `vosk-models/${targetFileName}`;

        const { Vosk } = await import('vosk-capacitor');

        // Use the plugin's copyFile method which handles content:// URIs
        const result = await Vosk.copyFile({
            sourcePath: sourcePath,
            fileName: targetPath
        });

        logger.log('debug', '[VoskDownloader] Model imported and extracted successfully:', result.path);
        return result.path;
    } catch (error) {
        logger.log('error', '[VoskDownloader] Import failed:', error);
        throw new Error(`Failed to import model: ${(error as any).message}`);
    }
}
