/**
 * Wake Word Model Downloader
 * Downloads OpenWakeWord models from GitHub releases
 */

import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';

/**
 * Model download information
 */
export interface WakeWordModelDownload {
    name: string;
    displayName: string;
    description: string;
    url: string;
    size: number; // Approximate size in bytes
    required: boolean; // True for base models
}

/**
 * Download progress callback
 */
export type DownloadProgressCallback = (progress: number, status: string) => void;

/**
 * Base URL for OpenWakeWord model releases
 */
const OPENWAKEWORD_BASE_URL = 'https://github.com/dscripka/openWakeWord/releases/download';
const OPENWAKEWORD_VERSION = 'v0.6.0';

/**
 * Available models for download
 */
export const DOWNLOADABLE_MODELS: WakeWordModelDownload[] = [
    // Required base models
    {
        name: 'melspectrogram.tflite',
        displayName: 'Mel Spectrogram',
        description: 'Required base model for audio feature extraction',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/melspectrogram.tflite`,
        size: 1_500_000, // ~1.5MB
        required: true,
    },
    {
        name: 'embedding_model.tflite',
        displayName: 'Embedding Model',
        description: 'Required base model for audio embeddings',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/embedding_model.tflite`,
        size: 2_000_000, // ~2MB
        required: true,
    },
    // Wake word models
    {
        name: 'hey_jarvis_v0.1.tflite',
        displayName: 'Hey Jarvis',
        description: 'General purpose wake word "Hey Jarvis"',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/hey_jarvis_v0.1.tflite`,
        size: 50_000, // ~50KB
        required: false,
    },
    {
        name: 'alexa_v0.1.tflite',
        displayName: 'Alexa',
        description: 'Amazon Alexa style wake word',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/alexa_v0.1.tflite`,
        size: 50_000,
        required: false,
    },
    {
        name: 'hey_mycroft_v0.1.tflite',
        displayName: 'Hey Mycroft',
        description: 'Mycroft assistant wake word',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/hey_mycroft_v0.1.tflite`,
        size: 50_000,
        required: false,
    },
    {
        name: 'hey_rhasspy_v0.1.tflite',
        displayName: 'Hey Rhasspy',
        description: 'Rhasspy assistant wake word',
        url: `${OPENWAKEWORD_BASE_URL}/${OPENWAKEWORD_VERSION}/hey_rhasspy_v0.1.tflite`,
        size: 50_000,
        required: false,
    },
];

/**
 * Wake Word Model Downloader Service
 */
export class WakeWordModelDownloader {
    private modelsDir = 'wakeword-models';

    /**
     * Check if a model is downloaded
     */
    async isModelDownloaded(modelName: string): Promise<boolean> {
        try {
            await Filesystem.stat({
                path: `${this.modelsDir}/${modelName}`,
                directory: Directory.Data,
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get list of downloaded models
     */
    async getDownloadedModels(): Promise<string[]> {
        try {
            const result = await Filesystem.readdir({
                path: this.modelsDir,
                directory: Directory.Data,
            });
            return result.files
                .filter(f => f.name.endsWith('.tflite'))
                .map(f => f.name);
        } catch {
            return [];
        }
    }

    /**
     * Check if all required base models are present
     */
    async hasRequiredModels(): Promise<boolean> {
        const hasMel = await this.isModelDownloaded('melspectrogram.tflite');
        const hasEmb = await this.isModelDownloaded('embedding_model.tflite');
        return hasMel && hasEmb;
    }

    /**
     * Download a model from URL
     */
    async downloadModel(
        model: WakeWordModelDownload,
        onProgress?: DownloadProgressCallback
    ): Promise<boolean> {
        try {
            logger.log('info', `Downloading wake word model: ${model.name}`);
            onProgress?.(0, `Starting download: ${model.displayName}`);

            // Ensure directory exists
            try {
                await Filesystem.mkdir({
                    path: this.modelsDir,
                    directory: Directory.Data,
                    recursive: true,
                });
            } catch {
                // Directory may already exist
            }

            // Download the file
            onProgress?.(10, 'Fetching model...');

            const response = await fetch(model.url);
            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const contentLength = response.headers.get('content-length');
            const totalSize = contentLength ? parseInt(contentLength) : model.size;

            // Read response as array buffer with progress tracking
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Failed to get response reader');
            }

            const chunks: Uint8Array[] = [];
            let receivedLength = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                receivedLength += value.length;

                const progress = Math.min(90, 10 + (receivedLength / totalSize) * 80);
                onProgress?.(progress, `Downloading: ${Math.round(receivedLength / 1024)}KB`);
            }

            // Combine chunks
            const allChunks = new Uint8Array(receivedLength);
            let position = 0;
            for (const chunk of chunks) {
                allChunks.set(chunk, position);
                position += chunk.length;
            }

            // Convert to base64
            onProgress?.(92, 'Processing...');
            const base64 = this.arrayBufferToBase64(allChunks.buffer);

            // Save to filesystem
            onProgress?.(95, 'Saving model...');
            await Filesystem.writeFile({
                path: `${this.modelsDir}/${model.name}`,
                data: base64,
                directory: Directory.Data,
            });

            onProgress?.(100, 'Complete!');
            logger.log('info', `Wake word model downloaded: ${model.name}`);

            return true;

        } catch (error) {
            logger.log('error', `Failed to download wake word model: ${model.name}`, error);
            onProgress?.(0, `Error: ${error instanceof Error ? error.message : 'Download failed'}`);
            return false;
        }
    }

    /**
     * Download all required base models
     */
    async downloadRequiredModels(
        onProgress?: DownloadProgressCallback
    ): Promise<boolean> {
        const requiredModels = DOWNLOADABLE_MODELS.filter(m => m.required);

        for (let i = 0; i < requiredModels.length; i++) {
            const model = requiredModels[i];
            const isDownloaded = await this.isModelDownloaded(model.name);

            if (!isDownloaded) {
                const baseProgress = (i / requiredModels.length) * 100;
                const success = await this.downloadModel(model, (progress, status) => {
                    const overallProgress = baseProgress + (progress / requiredModels.length);
                    onProgress?.(overallProgress, `${model.displayName}: ${status}`);
                });

                if (!success) {
                    return false;
                }
            } else {
                const progress = ((i + 1) / requiredModels.length) * 100;
                onProgress?.(progress, `${model.displayName}: Already downloaded`);
            }
        }

        return true;
    }

    /**
     * Delete a downloaded model
     */
    async deleteModel(modelName: string): Promise<boolean> {
        try {
            await Filesystem.deleteFile({
                path: `${this.modelsDir}/${modelName}`,
                directory: Directory.Data,
            });
            logger.log('info', `Deleted wake word model: ${modelName}`);
            return true;
        } catch (error) {
            logger.log('error', `Failed to delete wake word model: ${modelName}`, error);
            return false;
        }
    }

    /**
     * Get model file size
     */
    async getModelSize(modelName: string): Promise<number | null> {
        try {
            const stat = await Filesystem.stat({
                path: `${this.modelsDir}/${modelName}`,
                directory: Directory.Data,
            });
            return stat.size;
        } catch {
            return null;
        }
    }

    /**
     * Convert ArrayBuffer to base64 string
     */
    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}

// Singleton instance
let _downloader: WakeWordModelDownloader | null = null;

export function getWakeWordModelDownloader(): WakeWordModelDownloader {
    if (!_downloader) {
        _downloader = new WakeWordModelDownloader();
    }
    return _downloader;
}