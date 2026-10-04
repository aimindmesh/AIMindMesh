import { registerPlugin, Capacitor } from '@capacitor/core';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';

// Register plugin without strict typing since exports are incomplete
const LlamaCpp = registerPlugin('LlamaCpp') as any;

import { isDesktop } from '../../utils/platform';

export interface ModelDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
}

// Recommended lightweight models for Android
export const RECOMMENDED_MODELS = [
    {
        name: 'FunctionGemma-270M (Q4) 🔧',
        id: 'functiongemma-270m-q4',
        url: 'https://huggingface.co/Durlabh/gemma-270m-q4-k-m-gguf/resolve/main/gemma-270m-q4-k-m.gguf',
        size: 253000000, // ~253MB
        description: 'Tiny! Perfect for tool-use/function calling',
        category: 'tool-use',
    },
    {
        name: 'Phi-3-mini-4k-instruct (Q4)',
        id: 'phi-3-mini-q4',
        url: 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf',
        size: 2300000000, // ~2.3GB
        description: 'Fast and capable, great for mobile',
        category: 'chat',
    },
    {
        name: 'TinyLlama-1.1B (Q4)',
        id: 'tinyllama-q4',
        url: 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        size: 669000000, // ~669MB
        description: 'Very fast, basic quality',
        category: 'chat',
    },
    {
        name: 'Gemma-2B-it (Q4)',
        id: 'gemma-2b-q4',
        url: 'https://huggingface.co/google/gemma-2b-it-GGUF/resolve/main/gemma-2b-it.Q4_K_M.gguf',
        size: 1560000000, // ~1.56GB
        description: 'Good balance of speed and quality',
        category: 'chat',
    },
    {
        name: 'SmolLM2-1.7B-Instruct (Q4)',
        id: 'smollm2-1.7b-q4',
        url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf',
        size: 1040000000, // ~1.04GB
        description: 'Extremely efficient and high quality for its size',
        category: 'chat',
    },
];

/**
 * GGUF models for the Hexagon NPU (Qualcomm GenieX, llama_cpp runtime): Q4_0 weights, the format the
 * NPU kernels run, on the Fold5 (8 Gen 2) and the Fold7 (8 Elite). Files and sizes checked on the
 * Hugging Face API (none is gated). The id is the file name: GenieX reads the weight format from it.
 */
export const RECOMMENDED_GENIE_MODELS = [
    {
        name: 'Qwen3.5 4B · Q4_0 ⚡',
        id: 'Qwen3.5-4B-Q4_0',
        url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_0.gguf',
        size: 2583221408,
        description: 'Best quality under 5B. Hybrid attention: every turn re-reads the conversation (fast on the NPU).',
        category: 'chat',
        engine: 'genie',
    },
    {
        name: 'Qwen3.5 2B · Q4_0 ⚡',
        id: 'Qwen3.5-2B-Q4_0',
        url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_0.gguf',
        size: 1214873856,
        description: 'The lightest: quick answers and background memory work with little battery.',
        category: 'chat',
        engine: 'genie',
    },
    {
        name: 'Gemma 4 E2B · QAT Q4_0 ⚡',
        id: 'gemma-4-E2B_q4_0-it',
        url: 'https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/resolve/main/gemma-4-E2B_q4_0-it.gguf',
        size: 3349516256,
        description: 'Google quantization-aware Q4_0, ~2B effective. Reuses the conversation already read between turns.',
        category: 'chat',
        engine: 'genie',
    },
    {
        name: 'Gemma 4 E4B · QAT Q4_0 ⚡',
        id: 'gemma-4-E4B_q4_0-it',
        url: 'https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/main/gemma-4-E4B_q4_0-it.gguf',
        size: 5154941280,
        description: 'Google QAT Q4_0, ~4B effective: the strongest, but heavy for 12 GB phones. Check it with the benchmark.',
        category: 'chat',
        engine: 'genie',
    },
];

export const RECOMMENDED_PROJECTORS = [
    {
        name: 'LLaVA v1.5 Projector (f16)',
        id: 'llava-v1.5-mmproj-f16',
        url: 'https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/mmproj-model-f16.gguf',
        size: 300000000,
        description: 'For LLaVA v1.5 models',
    },
    {
        name: 'Qwen2-VL 7B Projector (f16)',
        id: 'qwen2-vl-7b-mmproj-f16',
        url: 'https://huggingface.co/ggml-org/Qwen2-VL-7B-Instruct-GGUF/resolve/main/mmproj-Qwen2-VL-7B-Instruct-f16.gguf',
        size: 200000000,
        description: 'For Qwen2-VL-7B models (ggml-org)',
    },
    {
        name: 'Llama 3.2 11B Vision Projector (f16)',
        id: 'llama-3.2-11b-vision-mmproj-f16',
        url: 'https://huggingface.co/leafspark/Llama-3.2-11B-Vision-Instruct-GGUF/resolve/main/Llama-3.2-11B-Vision-Instruct-mmproj.f16.gguf',
        size: 1940000000, // ~1.9GB
        description: 'For Llama 3.2 Vision models',
    },
    {
        name: 'Gemma 3 12B Projector (f16)',
        id: 'gemma-3-12b-mmproj-f16',
        url: 'https://huggingface.co/lmstudio-community/gemma-3-12b-it-GGUF/resolve/main/mmproj-model-f16.gguf',
        size: 300000000,
        description: 'For Gemma 3 12B models (lmstudio-community)',
    }
];

/**
 * Request storage permissions on Android
 */
async function requestStoragePermission(): Promise<boolean> {
    if (Capacitor.getPlatform() !== 'android') {
        return true; // Not needed on web/iOS
    }

    try {
        // The llama-cpp-capacitor plugin should handle permissions internally
        // We just log and return true - the plugin will request permissions when needed
        console.log('[ModelDownloader] Relying on plugin to handle storage permissions');
        return true;
    } catch (error) {
        console.error('[ModelDownloader] Permission error:', error);
        return false;
    }
}

// Download tracking lives in downloadTracking.ts; re-exported for existing importers
export { normalizeDownloadUrl, checkDownloadedSize, isTrackedStatus, toDownloadProgress, getDownloadStatus, trackDownload } from './downloadTracking';
import { normalizeDownloadUrl, trackDownload } from './downloadTracking';

/**
 * Download a GGUF model from URL.
 * With onProgress the promise waits for the end of the download and checks the file;
 * without it, it resolves as soon as the download has started.
 */
export async function downloadModel(
    url: string,
    filename: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    hfToken?: string
): Promise<string> {
    console.log('[ModelDownloader] Starting download:', filename);

    const finalUrl = normalizeDownloadUrl(url);

    // Request storage permissions first
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
        throw new Error('Storage permission denied. Please enable storage access in app settings.');
    }

    // Use the plugin's download functionality (resolves with { localPath } once started)
    const result = await LlamaCpp.downloadModel({
        url: finalUrl,
        filename,
        hfToken: hfToken || '',
    });

    // If no progress callback, return immediately
    if (!onProgress) {
        console.log('[ModelDownloader] Download started (background):', result);
        return result?.localPath || filename;
    }

    await trackDownload(finalUrl, filename, onProgress);
    console.log('[ModelDownloader] Download completed successfully:', filename);
    return result?.localPath || filename;
}

/**
 * Cancel an ongoing download
 */
export async function cancelDownload(url: string): Promise<boolean> {
    console.log('[ModelDownloader] Cancelling download:', url);
    return LlamaCpp.cancelDownload({ url: normalizeDownloadUrl(url) });
}

/**
 * Get list of locally available GGUF models
 */
export async function listLocalModels(): Promise<Array<{ name: string; path: string; size: number }>> {
    return LlamaCpp.getAvailableModels();
}

/**
 * Delete a local model
 */
export async function deleteLocalModel(filename: string): Promise<void> {
    console.log('[ModelDownloader] Deleting model:', filename);

    // Models are stored in app's data directory
    await Filesystem.deleteFile({
        path: filename,
        directory: Directory.Data,
    });
}

/**
 * Get model info (metadata from GGUF file)
 */
export async function getModelInfo(path: string): Promise<any> {
    return LlamaCpp.modelInfo({
        path,
        skip: [], // Don't skip any metadata
    });
}

/**
 * Check if a model exists locally
 */
export async function modelExists(filename: string): Promise<boolean> {
    try {
        await Filesystem.stat({
            path: filename,
            directory: Directory.Data,
        });
        return true;
    } catch {
        return false;
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
 * Import a GGUF file from external storage to app's Models directory
 */
export async function importGgufFile(sourcePath: string, fileName?: string): Promise<string> {
    console.log('[ModelDownloader] Importing GGUF file from:', sourcePath);

    // On Desktop, we avoid copying large files and just return the source path
    if (isDesktop()) {
        console.log('[ModelDownloader] Desktop detected, using direct path:', sourcePath);
        return sourcePath;
    }

    let targetFileName: string;

    if (fileName) {
        targetFileName = fileName;
    } else {
        // FIX: Decode the ENTIRE path first, so that we can correctly split by slashes
        const decodedPath = decodeURIComponent(sourcePath);
        const rawName = decodedPath.split('/').pop() || 'imported.gguf';

        // Extra safety: if the filename still looks like a path (contains :), strip it
        targetFileName = rawName;
        if (targetFileName.includes(':')) {
            targetFileName = targetFileName.split(':').pop() || targetFileName;
        }
    }

    if (!targetFileName.endsWith('.gguf')) {
        throw new Error('File must have .gguf extension');
    }

    try {
        // Use native file copy to avoid loading large files into memory
        // The LlamaCpp plugin should handle this natively
        const result = await LlamaCpp.copyFile({
            sourcePath: sourcePath,
            fileName: targetFileName
        });

        console.log('[ModelDownloader] File imported successfully:', targetFileName);
        return result.path || targetFileName;
    } catch (error) {
        console.error('[ModelDownloader] Import failed:', error);
        throw new Error(`Failed to import file: ${(error as any).message}`);
    }
}

/**
 * Import a LiteRT model file from external storage to app's data directory
 */
export async function importLiteRTFile(sourcePath: string, fileName?: string): Promise<string> {
    console.log('[ModelDownloader] Importing LiteRT file from:', sourcePath);

    // On Desktop, we avoid copying large files and just return the source path
    if (isDesktop()) {
        console.log('[ModelDownloader] Desktop detected, using direct path:', sourcePath);
        return sourcePath;
    }

    let targetFileName: string;

    if (fileName) {
        targetFileName = fileName;
    } else {
        // Decode the path first
        const decodedPath = decodeURIComponent(sourcePath);
        const rawName = decodedPath.split('/').pop() || 'imported.litertlm';

        // Extra safety: if the filename still looks like a path (contains :), strip it
        targetFileName = rawName;
        if (targetFileName.includes(':')) {
            targetFileName = targetFileName.split(':').pop() || targetFileName;
        }
    }

    // LiteRT uses .litertlm or .task extensions
    if (!targetFileName.endsWith('.litertlm') && !targetFileName.endsWith('.task')) {
        throw new Error('File must have .litertlm or .task extension');
    }

    try {
        // Use native file copy (same as GGUF)
        if (isDesktop()) {
            const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
            await copyFile(sourcePath, targetFileName, {
                toPathBaseDir: BaseDirectory.AppData
            });
            const result = { path: targetFileName };
            console.log('[ModelDownloader] LiteRT file imported successfully (desktop):', targetFileName);
            return result.path;
        }

        const result = await LlamaCpp.copyFile({
            sourcePath: sourcePath,
            fileName: targetFileName
        });

        console.log('[ModelDownloader] LiteRT file imported successfully:', targetFileName);
        return result.path || targetFileName;
    } catch (error) {
        console.error('[ModelDownloader] LiteRT import failed:', error);
        throw new Error(`Failed to import LiteRT file: ${(error as any).message}`);
    }
}

/**
 * Import a Multimodal Projector file from external storage
 */
export async function importProjectorFile(sourcePath: string, fileName?: string): Promise<string> {
    console.log('[ModelDownloader] Importing Projector file from:', sourcePath);

    // On Desktop, we avoid copying large files and just return the source path
    if (isDesktop()) {
        console.log('[ModelDownloader] Desktop detected, using direct path:', sourcePath);
        return sourcePath;
    }

    let targetFileName: string;

    if (fileName) {
        targetFileName = fileName;
    } else {
        // FIX: Decode the ENTIRE path first, so that we can correctly split by slashes
        // Android URIs might be like content://.../primary%3ADownload%2Ffolder%2Ffile.mmproj
        // If we split first, we get the whole encoded string. We must decode, then find the last segment.
        const decodedPath = decodeURIComponent(sourcePath);
        // Extract filename from the decoded path
        // Also handle specific Android 'primary:' prefix if it somehow persists in the last segment (unlikely after split, but safe to check)
        const rawName = decodedPath.split('/').pop() || 'imported.mmproj';
        targetFileName = rawName;

        // Extra safety: if the filename still looks like a path (contains :), strip it
        if (targetFileName.includes(':')) {
            targetFileName = targetFileName.split(':').pop() || targetFileName;
        }
    }

    // Ensure it has .mmproj extension for the app to recognize it
    if (!targetFileName.endsWith('.mmproj')) {
        if (targetFileName.endsWith('.gguf')) {
            targetFileName = targetFileName.substring(0, targetFileName.length - 5) + '.mmproj';
        } else {
            targetFileName += '.mmproj';
        }
    }

    try {
        if (isDesktop()) {
            const { copyFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
            await copyFile(sourcePath, targetFileName, {
                toPathBaseDir: BaseDirectory.AppData
            });
            const result = { path: targetFileName };
            console.log('[ModelDownloader] Projector imported successfully (desktop):', targetFileName);
            return result.path;
        }

        const result = await LlamaCpp.copyFile({
            sourcePath: sourcePath,
            fileName: targetFileName
        });

        console.log('[ModelDownloader] Projector imported successfully:', targetFileName);
        return result.path || targetFileName;
    } catch (error) {
        console.error('[ModelDownloader] Projector import failed:', error);
        throw new Error(`Failed to import projector: ${(error as any).message}`);
    }
}

/**
 * Get list of all local GGUF models
 */
export async function getLocalGgufModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: '',
            directory: Directory.Data
        });
        return result.files
            .map(f => f.name)
            .filter(name => name.endsWith('.gguf'));
    } catch (e) {
        console.error('[ModelDownloader] Failed to list local models', e);
        return [];
    }
}

/**
 * Get list of all local Projector files
 */
export async function getLocalProjectorFiles(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: '',
            directory: Directory.Data
        });
        return result.files
            .map(f => f.name)
            .filter(name => name.endsWith('.mmproj'));
    } catch (e) {
        console.error('[ModelDownloader] Failed to list local projectors', e);
        return [];
    }
}

/**
 * Get list of all local LiteRT models
 */
export async function getLocalLiteRTModels(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: '',
            directory: Directory.Data
        });
        return result.files
            .map(f => f.name)
            .filter(name => name.endsWith('.litertlm') || name.endsWith('.task'));
    } catch (e) {
        console.error('[ModelDownloader] Failed to list local LiteRT models', e);
        return [];
    }
}

/**
 * Delete a local model or projector
 */
export async function deleteModel(modelId: string): Promise<void> {
    try {
        // Handle .gguf, .mmproj, .litertlm, .task
        let filename = modelId;
        const validExtensions = ['.gguf', '.mmproj', '.litertlm', '.task'];
        const hasValidExt = validExtensions.some(ext => filename.endsWith(ext));

        if (!hasValidExt) {
            filename += '.gguf'; // Default to gguf if no known extension
        }

        await Filesystem.deleteFile({
            path: filename,
            directory: Directory.Data
        });
        console.log('[ModelDownloader] File deleted:', filename);
    } catch (error) {
        console.error('[ModelDownloader] Failed to delete file:', error);
        throw error;
    }
}
