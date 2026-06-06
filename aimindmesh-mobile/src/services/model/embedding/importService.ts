import { FileSystemAdapter as Filesystem, Directory } from '../../../utils/fileSystemAdapter';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { logger } from '../../logger';
import { EMBEDDING_MODELS_DIR } from './types';
import { ensureModelsDir } from './localModelService';

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
 * Import embedding model from a ZIP file
 * ZIP must contain: model.onnx, tokenizer.json, config.json, tokenizer_config.json
 * 
 * NOTE: This function now uses file path instead of loading data to avoid OOM
 * with large model files (~200MB+).
 */
export async function importEmbeddingModel(onProgress?: (progress: number) => void): Promise<string> {
    // Pick ZIP file - DO NOT read data to avoid OOM with large files
    const result = await FilePicker.pickFiles({
        types: ['application/zip'],
        readData: false, // CRITICAL: Don't load into memory
    });

    if (result.files.length === 0) {
        throw new Error('No file selected');
    }

    const file = result.files[0];
    if (!file.path) {
        throw new Error('Failed to get file path - file access denied');
    }

    // Get model name from filename (remove .zip extension)
    const modelId = (file.name || 'imported-model')
        .replace(/\.zip$/i, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .toLowerCase();

    await ensureModelsDir();

    const modelDir = `${EMBEDDING_MODELS_DIR}/${modelId}`;

    // Create model directory
    try {
        await Filesystem.mkdir({
            path: modelDir,
            directory: Directory.Data,
            recursive: true,
        });
    } catch (e) {
        // May already exist
    }

    logger.log('info', `Importing embedding model: ${modelId} from ${file.path}`);
    onProgress?.(10);

    try {
        // Copy ZIP file using native file copy (avoids loading into memory)
        const zipDestPath = `${modelDir}/temp.zip`;

        // Use Filesystem.copy for native file transfer
        await Filesystem.copy({
            from: file.path,
            to: zipDestPath,
            toDirectory: Directory.Data,
        });
        onProgress?.(40);

        logger.log('info', 'ZIP file copied to app storage');

        // TODO: Use JSZip or native unzip to extract
        // For now, user should import pre-extracted directory
        // We'll add unzip support when we add the native unzip plugin

        // Check if this is actually a directory (some file pickers return dirs as zip)
        const zipStat = await Filesystem.stat({
            path: zipDestPath,
            directory: Directory.Data,
        });

        logger.log('info', `ZIP imported: ${(zipStat.size || 0) / 1024 / 1024} MB`);
        onProgress?.(70);

        // For now, provide guidance to users
        logger.log('warn', 'ZIP extraction not implemented - please import pre-extracted model directory');

        onProgress?.(100);
        return modelId;
    } catch (e) {
        logger.log('error', 'Failed to import embedding model', e);
        // Cleanup on failure
        try {
            await Filesystem.rmdir({
                path: modelDir,
                directory: Directory.Data,
                recursive: true,
            });
        } catch { }
        throw e;
    }
}

/**
 * Import embedding model from a directory (pre-extracted)
 * Directory must contain: model.onnx, tokenizer.json
 */
export async function importEmbeddingModelFromDir(
    sourcePath: string,
    modelId?: string
): Promise<string> {
    const id = modelId || `imported-${Date.now()}`;

    await ensureModelsDir();

    const destDir = `${EMBEDDING_MODELS_DIR}/${id}`;

    try {
        // Copy directory contents
        await Filesystem.copy({
            from: sourcePath,
            to: destDir,
            directory: Directory.Data,
            toDirectory: Directory.Data,
        });

        // Verify files
        const hasModel = await fileExists(`${destDir}/model.onnx`);
        const hasTokenizer = await fileExists(`${destDir}/tokenizer.json`);

        if (!hasModel || !hasTokenizer) {
            throw new Error('Model directory must contain model.onnx and tokenizer.json');
        }

        logger.log('info', `Imported embedding model: ${id}`);
        return id;
    } catch (e) {
        logger.log('error', 'Failed to import embedding model from directory', e);
        throw e;
    }
}
