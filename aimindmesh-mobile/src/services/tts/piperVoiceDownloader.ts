import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

export interface PiperVoiceModel {
    id: string;
    name: string;
    language: 'en' | 'it';
    gender: 'male' | 'female';
    quality: 'x_low' | 'low' | 'medium' | 'high';
    size: number;
    url: string;
    description: string;
}

export interface VoiceDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
}

// Piper TTS voice models for English and Italian
export const PIPER_VOICES: PiperVoiceModel[] = [
    // English Voices
    {
        id: 'en_US-amy-medium',
        name: 'Amy (US English) - Standard',
        language: 'en',
        gender: 'female',
        quality: 'medium',
        size: 45000000, // ~45MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx',
        description: 'Good balance of quality and speed'
    },
    {
        id: 'en_US-libritts-high',
        name: 'LibriTTS (US English) - High Quality',
        language: 'en',
        gender: 'female',
        quality: 'high',
        size: 100000000, // ~100MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/libritts/high/en_US-libritts-high.onnx',
        description: 'Maximum quality, multi-speaker'
    },

    // Italian Voices - Male
    {
        id: 'it_IT-riccardo_bella-medium',
        name: 'Riccardo Bella (Italiano) - Standard',
        language: 'it',
        gender: 'male',
        quality: 'medium',
        size: 40000000, // ~40MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/riccardo_bella/medium/it_IT-riccardo_bella-medium.onnx',
        description: 'Voce maschile, qualità standard'
    },
    {
        id: 'it_IT-riccardo_bella-high',
        name: 'Riccardo Bella (Italiano) - Alta Qualità',
        language: 'it',
        gender: 'male',
        quality: 'high',
        size: 95000000, // ~95MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/riccardo_bella/high/it_IT-riccardo_bella-high.onnx',
        description: 'Voce maschile, massima qualità'
    },

    // Italian Voices - Female
    {
        id: 'it_IT-paola-medium',
        name: 'Paola (Italiano) - Standard',
        language: 'it',
        gender: 'female',
        quality: 'medium',
        size: 40000000, // ~40MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/paola/medium/it_IT-paola-medium.onnx',
        description: 'Voce femminile, qualità standard - Raccomandata'
    },
    {
        id: 'it_IT-mls_1840-low',
        name: 'MLS 1840 (Italiano)',
        language: 'it',
        gender: 'female',
        quality: 'low',
        size: 25000000, // ~25MB
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/mls_1840/low/it_IT-mls_1840-low.onnx',
        description: 'Voce femminile alternativa'
    },
];

/**
 * Download a Piper voice model
 * Note: This is a placeholder. The actual download will be handled by a native plugin
 * once we create the custom Piper Capacitor plugin.
 */
export async function downloadPiperVoice(
    voice: PiperVoiceModel,
    onProgress?: (progress: VoiceDownloadProgress) => void
): Promise<string> {
    logger.log('debug', '[PiperDownloader] Starting download:', voice.id);

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Piper voices can only be downloaded on native platforms');
    }

    const { Piper } = await import('piper-capacitor');

    // Setup progress listener
    let progressListener: any;
    if (onProgress) {
        progressListener = await Piper.addListener('downloadProgress', (data: { progress: number }) => {
            onProgress({
                bytesDownloaded: 0,
                totalBytes: voice.size,
                percentage: data.progress,
                completed: false,
                failed: false
            });
        });
    }

    try {
        // Download ONNX model
        const modelPath = `piper-voices/${voice.id}.onnx`;
        await Piper.downloadVoice({
            url: voice.url,
            path: modelPath
        });

        // Download JSON config (append .json to URL)
        const configUrl = voice.url + '.json';
        const configPath = `piper-voices/${voice.id}.onnx.json`;
        await Piper.downloadVoice({
            url: configUrl,
            path: configPath
        });

        return modelPath;
    } finally {
        if (progressListener) {
            progressListener.remove();
        }
    }
}

/**
 * Delete a local Piper voice model
 */
export async function deletePiperVoice(voiceId: string): Promise<void> {
    logger.log('debug', '[PiperDownloader] Deleting voice:', voiceId);

    try {
        const modelPath = `piper-voices/${voiceId}.onnx`;
        const configPath = `piper-voices/${voiceId}.onnx.json`;

        await Filesystem.deleteFile({
            path: modelPath,
            directory: Directory.Data
        });

        await Filesystem.deleteFile({
            path: configPath,
            directory: Directory.Data
        });
    } catch (error) {
        logger.log('error', '[PiperDownloader] Error deleting voice:', error);
        throw error;
    }
}

/**
 * Check if a Piper voice exists locally
 */
export async function piperVoiceExists(voiceId: string): Promise<boolean> {
    try {
        const modelPath = `piper-voices/${voiceId}.onnx`;
        await Filesystem.stat({
            path: modelPath,
            directory: Directory.Data
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * List all locally available Piper voices
 */
export async function listLocalPiperVoices(): Promise<string[]> {
    try {
        const result = await Filesystem.readdir({
            path: 'piper-voices',
            directory: Directory.Data
        });

        // Filter only .onnx files and remove extension
        return result.files
            .map(f => f.name)
            .filter(name => name.endsWith('.onnx'))
            .map(name => name.replace('.onnx', ''));
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
 * Import Piper voice files (ONNX and JSON) from phone storage
 */

export async function importPiperVoice(
    onnxPath: string,
    jsonPath: string,
    voiceId?: string
): Promise<string> {
    logger.log('debug', '[PiperDownloader] Importing voice from:', onnxPath);

    // On Desktop, we avoid copying and just return the source path
    if (isDesktop()) {
        logger.log('info', `[PiperDownloader] Desktop detected, using direct path: ${onnxPath}`);
        // We assume the JSON is accessible or passed correctly. 
        // For Piper on desktop, we usually need both files.
        // If the user picked them, we have the paths.
        // The backend likely needs the ONNX path, and expects the JSON to be `path.json`.
        // If the user picked an ONNX and a JSON that are NOT side-by-side or named correctly, this might fail in the backend.
        // But for now, returning the ONNX path is the correct step for "no-copy".
        return onnxPath;
    }

    if (!Capacitor.isNativePlatform()) {
        throw new Error('Piper voices can only be imported on native platforms');
    }

    try {
        let targetVoiceId: string;

        if (voiceId) {
            targetVoiceId = voiceId;
        } else {
            // Extract filename from ONNX path
            const onnxFileName = onnxPath.split('/').pop() || 'imported-voice.onnx';
            if (!onnxFileName.endsWith('.onnx')) {
                // warning?
            }
            // Determine voice ID from filename (remove .onnx extension)
            targetVoiceId = onnxFileName.replace('.onnx', '');
        }

        const { Piper } = await import('piper-capacitor');

        // Copy ONNX file using the plugin's copyFile method
        const targetOnnxPath = `piper-voices/${targetVoiceId}.onnx`;
        await Piper.copyFile({
            sourcePath: onnxPath,
            fileName: targetOnnxPath
        });

        logger.log('debug', '[PiperDownloader] ONNX copied to:', targetOnnxPath);

        // Copy JSON config file
        if (!jsonPath) {
            throw new Error('JSON config file path is required');
        }

        try {
            const targetJsonPath = `piper-voices/${targetVoiceId}.onnx.json`;
            await Piper.copyFile({
                sourcePath: jsonPath,
                fileName: targetJsonPath
            });

            logger.log('debug', '[PiperDownloader] JSON copied to:', targetJsonPath);
        } catch (jsonError) {
            logger.log('error', '[PiperDownloader] JSON copy failed:', jsonError);
            // Clean up the ONNX file if JSON failed
            try {
                await Filesystem.deleteFile({
                    path: targetOnnxPath,
                    directory: Directory.Data
                });
            } catch (e) {
                // Ignore cleanup error
            }
            throw new Error('Failed to copy JSON config file. Both ONNX and JSON files are required.');
        }

        logger.log('debug', '[PiperDownloader] Voice imported successfully:', voiceId);
        return targetOnnxPath;
    } catch (error) {
        logger.log('error', '[PiperDownloader] Import failed:', error);
        throw new Error(`Failed to import voice: ${(error as any).message}`);
    }
}

