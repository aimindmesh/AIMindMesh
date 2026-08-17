import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

export const SD_MODELS_DIR = 'sd-models';

export interface SDModelInfo {
    id: string;
    name: string;
    path: string;
    isCustom?: boolean;
}

/**
 * Check if a Stable Diffusion model directory exists locally
 */
export async function sdModelExists(modelId: string): Promise<boolean> {
    try {
        const dirPath = `${SD_MODELS_DIR}/${modelId}`;
        const stat = await Filesystem.stat({
            path: dirPath,
            directory: Directory.Data
        });
        return !!stat;
    } catch {
        return false;
    }
}

/**
 * List all locally available Stable Diffusion models in sd-models directory
 */
export async function listLocalSDModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: SD_MODELS_DIR,
            directory: Directory.Data
        });

        const models: string[] = [];
        for (const file of result.files) {
            const name = typeof file === 'string' ? file : file?.name;
            const type = typeof file === 'object' ? file?.type : undefined;
            if (name && (type === 'directory' || !type)) {
                if (!name.startsWith('.') && name !== '__MACOSX') {
                    models.push(name);
                }
            }
        }
        return models;
    } catch (e) {
        // Directory may not exist yet
        return [];
    }
}

/**
 * Get the full path or URI to an SD model directory (normalized absolute path)
 */
export async function getSDModelPath(modelId: string): Promise<string | null> {
    try {
        const dirPath = `${SD_MODELS_DIR}/${modelId}`;
        const stat = await Filesystem.stat({
            path: dirPath,
            directory: Directory.Data
        });
        if (!stat) return null;
        let cleanUri = stat.uri;
        if (cleanUri && cleanUri.startsWith('file://')) {
            cleanUri = cleanUri.replace(/^file:\/\//, '');
        }
        return cleanUri || dirPath;
    } catch {
        return null;
    }
}

/**
 * Delete a local Stable Diffusion model directory
 */
export async function deleteSDModel(modelId: string): Promise<void> {
    logger.log('info', `[SDModelDownloader] Deleting SD model: ${modelId}`);

    try {
        const dirPath = `${SD_MODELS_DIR}/${modelId}`;
        await Filesystem.rmdir({
            path: dirPath,
            directory: Directory.Data,
            recursive: true
        });
        logger.log('info', `[SDModelDownloader] Deleted model directory: ${modelId}`);
    } catch (error) {
        logger.log('error', `[SDModelDownloader] Error deleting model ${modelId}:`, error);
        throw error;
    }
}

/**
 * Import a Stable Diffusion model bundle (.zip or directory) into sd-models
 */
export async function importSDModel(sourcePath: string, fileName?: string): Promise<string> {
    logger.log('info', `[SDModelDownloader] Importing model from: ${sourcePath}`);

    if (isDesktop()) {
        logger.log('info', `[SDModelDownloader] Desktop detected, using path: ${sourcePath}`);
        return sourcePath;
    }

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Stable Diffusion models can only be imported on native platforms');
    }

    try {
        const { SD } = await import('sd-capacitor');

        let targetFileName: string;
        if (fileName) {
            targetFileName = fileName;
        } else {
            targetFileName = sourcePath.split('/').pop() || 'imported_sd_model.zip';
        }

        if (!targetFileName.toLowerCase().endsWith('.zip') && !sourcePath.toLowerCase().endsWith('.zip')) {
            if (!targetFileName.includes('.')) {
                targetFileName += '.zip';
            }
        }

        const targetPath = `${SD_MODELS_DIR}/${targetFileName}`;

        const result = await SD.copyFile({
            sourcePath: sourcePath,
            fileName: targetPath
        });

        const cleanPath = result.path.replace(/^file:\/\//, '');
        logger.log('info', `[SDModelDownloader] SD Model imported and extracted to: ${cleanPath}`);
        return cleanPath;
    } catch (error) {
        logger.log('error', `[SDModelDownloader] Import failed: ${(error as any).message}`);
        throw new Error(`Failed to import SD model: ${(error as any).message}`);
    }
}
