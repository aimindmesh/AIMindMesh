import { registerPlugin, Capacitor } from '@capacitor/core';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';

// Register plugin without strict typing since exports are incomplete  
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

/**
 * Download a GGUF model from URL
 */
export async function downloadModel(
    url: string,
    filename: string,
    onProgress?: (progress: ModelDownloadProgress) => void,
    hfToken?: string
): Promise<string> {
    console.log('[ModelDownloader] Starting download:', filename);

    // Sanitize URL for HuggingFace (blob -> resolve)
    let finalUrl = url;
    if (finalUrl.includes('huggingface.co') && finalUrl.includes('/blob/')) {
        console.log('[ModelDownloader] Fixing HuggingFace URL (blob -> resolve)');
        finalUrl = finalUrl.replace('/blob/', '/resolve/');
    }

    // Request storage permissions first
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
        throw new Error('Storage permission denied. Please enable storage access in app settings.');
    }

    // Use the plugin's download functionality
    const result = await LlamaCpp.downloadModel({
        url: finalUrl,
        filename,
        hfToken: hfToken || '',
    });

    // If no progress callback, return immediately
    if (!onProgress) {
        console.log('[ModelDownloader] Download started (background):', result);
        return result;
    }

    // Wait for completion if tracking progress
    return new Promise<string>((resolve, reject) => {
        const progressInterval = setInterval(async () => {
            try {
                const progress = await LlamaCpp.getDownloadProgress({ url: finalUrl });

                onProgress({
                    bytesDownloaded: progress.bytesDownloaded || 0,
                    totalBytes: progress.totalBytes || 0,
                    percentage: progress.totalBytes > 0 ? (progress.bytesDownloaded / progress.totalBytes) * 100 : 0,
                    completed: progress.completed,
                    failed: progress.failed,
                    errorMessage: progress.error,
                });

                if (progress.completed) {
                    clearInterval(progressInterval);

                    // Verify file size locally to ensure it's not a 404 page
                    // This adds safety even if native plugin isn't rebuilt immediately
                    Filesystem.stat({
                        path: filename,
                        directory: Directory.Data
                    }).then(stat => {
                        if (stat.size < 1024) {
                            console.error('[ModelDownloader] Downloaded file is too small (' + stat.size + ' bytes). Deleting...');
                            Filesystem.deleteFile({ path: filename, directory: Directory.Data }).catch(() => { });
                            reject(new Error('Download failed: File too small (likely 404 error)'));
                        } else {
                            console.log('[ModelDownloader] Download completed successfully:', result);
                            resolve(result); // Return the local path
                        }
                    }).catch(e => {
                        // Stat failed? ensure we don't hang
                        console.warn('Failed to verify file size', e);
                        resolve(result);
                    });
                } else if (progress.failed || progress.cancelled) {
                    clearInterval(progressInterval);
                    console.error('[ModelDownloader] Download failed or cancelled:', progress.error);
                    reject(new Error(progress.error || 'Download cancelled'));
                }
            } catch (error) {
                // Ignore errors during polling (might be temporary)
                // or handle max retries?
                console.warn('[ModelDownloader] Error polling progress:', error);
            }
        }, 500); // Update every 500ms
    });
}

/**
 * Cancel an ongoing download
 */
export async function cancelDownload(url: string): Promise<boolean> {
    console.log('[ModelDownloader] Cancelling download:', url);
    return LlamaCpp.cancelDownload({ url });
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
