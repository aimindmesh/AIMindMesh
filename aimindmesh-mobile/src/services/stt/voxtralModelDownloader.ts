import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

/**
 * Import a Voxtral GGUF model file
 * @param sourcePath Source path (can be content:// URI on Android)
 * @param fileName Target filename
 * @returns Final path to the imported model
 */
export async function importVoxtralModel(
    sourcePath: string,
    fileName?: string
): Promise<string> {
    logger.log('debug', '[VoxtralDownloader] Importing model from:', sourcePath);

    // On Desktop, we avoid copying and just return the source path
    if (isDesktop()) {
        logger.log('info', `[VoxtralDownloader] Desktop detected, using direct path: ${sourcePath}`);
        return sourcePath;
    }

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Voxtral models can only be imported on native platforms');
    }

    try {
        let targetFileName: string;

        if (fileName) {
            targetFileName = fileName;
        } else {
            // Extract filename from path (fallback logic)
            const extractedName = sourcePath.split('/').pop() || 'imported-model.gguf';
            if (!extractedName.toLowerCase().endsWith('.gguf')) {
                logger.log('warn', '[VoxtralDownloader] Warning: Source might not be a GGUF, but proceeding:', extractedName);
            }
            targetFileName = extractedName;
        }

        const targetPath = `voxtral-models/${targetFileName}`;

        // Ensure directory exists
        try {
            await Filesystem.mkdir({
                path: 'voxtral-models',
                directory: Directory.Data,
                recursive: true
            });
        } catch (e) {
            // Directory might already exist
            logger.log('debug', '[VoxtralDownloader] Directory already exists or error creating it:', e);
        }

        // Use native plugin copy to avoid OOM with large files
        // This mirrors how Vosk/Whisper handle imports
        const { default: Voxtral } = await import('./voxtralPlugin');

        await Voxtral.copyFile({
            sourcePath: sourcePath,
            fileName: targetPath
        });

        logger.log('debug', '[VoxtralDownloader] Model imported successfully:', targetPath);
        return targetPath;
    } catch (error) {
        logger.log('error', '[VoxtralDownloader] Import failed:', error);
        throw new Error(`Failed to import model: ${(error as any).message}`);
    }
}

/**
 * List locally imported Voxtral models
 */
export async function listLocalVoxtralModels(): Promise<string[]> {
    if (!Capacitor.isNativePlatform()) {
        return [];
    }

    try {
        const result = await Filesystem.readdir({
            path: 'voxtral-models',
            directory: Directory.Data
        });
        return result.files.map(f => `voxtral-models/${f.name}`).filter(f => f.endsWith('.gguf') && !f.includes('mmproj'));
    } catch {
        return [];
    }
}

/**
 * List locally imported Voxtral projectors (.mmproj or mmproj*.gguf)
 */
export async function listLocalVoxtralProjectors(): Promise<string[]> {
    if (!Capacitor.isNativePlatform()) {
        return [];
    }

    try {
        const result = await Filesystem.readdir({
            path: 'voxtral-models',
            directory: Directory.Data
        });
        return result.files.map(f => `voxtral-models/${f.name}`).filter(f =>
            f.endsWith('.mmproj') || (f.endsWith('.gguf') && f.includes('mmproj'))
        );
    } catch {
        return [];
    }
}

/**
 * Delete a Voxtral model
 */
export async function deleteVoxtralModel(modelPath: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        throw new Error('Can only delete models on native platforms');
    }

    try {
        await Filesystem.deleteFile({
            path: modelPath,
            directory: Directory.Data
        });
        logger.log('info', '[VoxtralDownloader] Model deleted:', modelPath);
    } catch (error) {
        logger.log('error', '[VoxtralDownloader] Failed to delete model:', error);
        throw error;
    }
}

/**
 * Check if a Voxtral model exists
 */
export async function voxtralModelExists(modelPath: string): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
        return false;
    }

    try {
        await Filesystem.stat({
            path: modelPath,
            directory: Directory.Data
        });
        return true;
    } catch {
        return false;
    }
}
