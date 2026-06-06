/**
 * VAD (Voice Activity Detection) Service
 * TypeScript wrapper for the vad-capacitor native plugin.
 * Uses Silero VAD for detecting speech segments in audio.
 */

import { logger } from '../logger';

// Plugin import will be available after native build
let VAD: any;
try {
    VAD = require('vad-capacitor').VAD;
} catch {
    // Plugin not available (web or not built yet)
    VAD = null;
}

/**
 * VAD result for streaming mode
 */
export interface VADResult {
    isSpeech: boolean;
    confidence: number;
    speechStartMs?: number;
    speechEndMs?: number;
}

/**
 * Detected speech segment
 */
export interface SpeechSegment {
    startMs: number;
    endMs: number;
    durationMs: number;
}

/**
 * VAD threshold configuration
 */
export interface VADThresholds {
    speechThreshold?: number;     // 0-1, default 0.5
    silenceDurationMs?: number;   // ms to end segment, default 300
    minSpeechDurationMs?: number; // min segment length, default 250
}

/**
 * VAD Service for voice activity detection
 */
export class VADService {
    private isModelLoaded = false;
    private currentModelId: string | null = null;
    private thresholds: Required<VADThresholds> = {
        speechThreshold: 0.5,
        silenceDurationMs: 300,
        minSpeechDurationMs: 250
    };

    constructor() {
        logger.log('info', 'VADService initialized');
    }

    /**
     * Check if VAD is available (native plugin installed)
     */
    public isAvailable(): boolean {
        return VAD !== null;
    }

    /**
     * Load a Silero VAD model
     * @param modelId Model ID (e.g., 'silero-vad-v4')
     */
    public async loadModel(modelId: string): Promise<void> {
        if (!this.isAvailable()) {
            throw new Error('VAD plugin not available');
        }

        try {
            if (this.isModelLoaded && this.currentModelId !== modelId) {
                await this.unloadModel();
            }

            const modelPath = `vad-models/${modelId}.onnx`;
            logger.log('info', `Loading VAD model: ${modelPath}`);

            await VAD.loadModel({ modelPath });

            // Apply current thresholds
            await this.setThresholds(this.thresholds);

            this.isModelLoaded = true;
            this.currentModelId = modelId;
            logger.log('info', 'VAD model loaded successfully');
        } catch (error) {
            logger.log('error', 'Failed to load VAD model', error);
            throw error;
        }
    }

    /**
     * Unload the current model
     */
    public async unloadModel(): Promise<void> {
        if (!this.isAvailable() || !this.isModelLoaded) {
            return;
        }

        try {
            await VAD.unloadModel();
            this.isModelLoaded = false;
            this.currentModelId = null;
            logger.log('info', 'VAD model unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload VAD model', error);
        }
    }

    /**
     * Check if model is loaded
     */
    public async checkModelLoaded(): Promise<boolean> {
        if (!this.isAvailable()) {
            return false;
        }

        try {
            const result = await VAD.isModelLoaded();
            this.isModelLoaded = result.loaded;
            return result.loaded;
        } catch {
            return false;
        }
    }

    /**
     * Configure VAD thresholds
     */
    public async setThresholds(thresholds: VADThresholds): Promise<void> {
        this.thresholds = { ...this.thresholds, ...thresholds };

        if (this.isAvailable() && this.isModelLoaded) {
            try {
                await VAD.setThresholds(this.thresholds);
            } catch (error) {
                logger.log('warn', 'Failed to set VAD thresholds', error);
            }
        }
    }

    /**
     * Get current thresholds
     */
    public getThresholds(): Required<VADThresholds> {
        return { ...this.thresholds };
    }

    /**
     * Process audio samples for voice activity detection (streaming mode)
     * @param samples Base64 encoded Float32 audio samples (16kHz mono)
     */
    public async processSamples(samples: string): Promise<VADResult> {
        if (!this.isAvailable()) {
            throw new Error('VAD plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No VAD model loaded. Call loadModel first.');
        }

        try {
            return await VAD.processSamples({ samples });
        } catch (error) {
            logger.log('error', 'VAD processing failed', error);
            throw error;
        }
    }

    /**
     * Process entire audio file and extract speech segments
     * @param audioPath Path to audio file (WAV, 16kHz mono)
     */
    public async processFile(audioPath: string): Promise<SpeechSegment[]> {
        if (!this.isAvailable()) {
            throw new Error('VAD plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No VAD model loaded. Call loadModel first.');
        }

        logger.log('info', `Processing file for VAD: ${audioPath}`);

        try {
            const result = await VAD.processFile({ audioPath });
            return result.segments || [];
        } catch (error) {
            logger.log('error', 'VAD file processing failed', error);
            throw error;
        }
    }

    /**
     * Reset VAD state (call between recordings)
     */
    public async reset(): Promise<void> {
        if (!this.isAvailable()) return;

        try {
            await VAD.reset();
        } catch (error) {
            logger.log('warn', 'Failed to reset VAD state', error);
        }
    }

    /**
     * Filter transcript segments to only include speech regions
     * @param segments Transcript segments with timestamps
     * @param speechRegions VAD-detected speech regions
     */
    public filterToSpeechRegions<T extends { timestamp: number }>(
        segments: T[],
        speechRegions: SpeechSegment[]
    ): T[] {
        return segments.filter(segment => {
            return speechRegions.some(speech =>
                segment.timestamp >= speech.startMs &&
                segment.timestamp <= speech.endMs
            );
        });
    }

    /**
     * Merge adjacent speech segments
     * @param segments Speech segments
     * @param maxGapMs Maximum gap to merge (ms)
     */
    public mergeSegments(segments: SpeechSegment[], maxGapMs: number = 300): SpeechSegment[] {
        if (segments.length === 0) return [];

        const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
        const merged: SpeechSegment[] = [{ ...sorted[0] }];

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const last = merged[merged.length - 1];

            if (current.startMs - last.endMs <= maxGapMs) {
                // Merge
                last.endMs = Math.max(last.endMs, current.endMs);
                last.durationMs = last.endMs - last.startMs;
            } else {
                merged.push({ ...current });
            }
        }

        return merged;
    }
}

// Singleton instance
let _vadService: VADService | null = null;

/**
 * Get the singleton VAD service
 */
export function getVADService(): VADService {
    if (!_vadService) {
        _vadService = new VADService();
    }
    return _vadService;
}
