/**
 * Voxtral STT Service
 * Wrapper for the voxtral Capacitor plugin providing real-time and batch transcription.
 */

import { logger } from '../logger';
import Voxtral from './voxtralPlugin';
import type { PluginListenerHandle } from '@capacitor/core';

export interface VoxtralToken {
    text: string;
    timestampMs: number;
    confidence: number;
    startMs?: number;
    endMs?: number;
}

export interface VoxtralSegment {
    text: string;
    start: number;
    end: number;
    confidence: number;
}

export interface VoxtralConfig {
    modelPath: string;
    transcriptionDelayMs?: 240 | 480 | 960 | 2400;
    maxModelLen?: number;
    nThreads?: number;
}

export interface VoxtralTranscriptResult {
    text: string;
    segments: VoxtralSegment[];
}

/**
 * Voxtral STT Service
 * Provides streaming and batch transcription using Mistral Voxtral Mini 4B Realtime
 */
export class VoxtralSTTService {
    private isModelLoaded = false;
    private currentModelPath: string | null = null;
    private isStreaming = false;
    private tokenListener: PluginListenerHandle | null = null;
    private errorListener: PluginListenerHandle | null = null;
    private accumulatedTranscript: string = '';
    private currentCallback: ((text: string, tokens: VoxtralToken[]) => void) | null = null;
    private onErrorCallback: ((error: { code: number; message: string }) => void) | null = null;

    constructor() {
        logger.log('info', 'Voxtral STT Service initialized');
    }

    /**
     * Check if Voxtral is available
     */
    public isAvailable(): boolean {
        return true; // Plugin is installed
    }

    /**
     * Load a Voxtral model
     * @param config Model configuration
     */
    public async loadModel(config: VoxtralConfig): Promise<void> {
        console.log('[Voxtral-DEBUG] === loadModel called');
        console.log('[Voxtral-DEBUG] isModelLoaded (local):', this.isModelLoaded);
        console.log('[Voxtral-DEBUG] config.modelPath:', config.modelPath);

        // [CRITICAL FIX] Always check native state FIRST
        // The local isModelLoaded flag can become stale after webview reload
        try {
            const nativeInfo = await Voxtral.getModelInfo();
            console.log('[Voxtral-DEBUG] Native info:', JSON.stringify(nativeInfo));

            if (nativeInfo.loaded && nativeInfo.modelPath) {
                // Normalize paths for comparison - extract filename only
                // config.modelPath might be "voxtral-models/file.gguf"
                // nativeInfo.modelPath will be "/data/user/0/.../voxtral-models/file.gguf"
                const configFilename = config.modelPath.split('/').pop() || '';
                const nativeFilename = nativeInfo.modelPath.split('/').pop() || '';

                console.log('[Voxtral-DEBUG] Comparing filenames:', {
                    config: configFilename,
                    native: nativeFilename,
                    match: configFilename === nativeFilename
                });

                if (configFilename === nativeFilename) {
                    console.log('[Voxtral-DEBUG] ✅ Native model matches! Hydrating state...');
                    logger.log('info', `[VoxtralSTT] 🟢 Model already loaded in native layer. Hydrating state...`);
                    this.isModelLoaded = true;
                    this.currentModelPath = config.modelPath;
                    return;
                }
            }
            console.log('[Voxtral-DEBUG] Native model mismatch or not loaded');
        } catch (e) {
            console.log('[Voxtral-DEBUG] ⚠️ Native state check failed:', e);
            logger.log('debug', '[VoxtralSTT] Native state check failed, proceeding with init');
        }

        logger.log('info', `Loading Voxtral model: ${config.modelPath}`);

        try {
            // Unload current model if any
            if (this.isModelLoaded) {
                await this.unloadModel();
            }

            // Memory coordination: try to unload main LLM to free RAM
            try {
                const { releaseAllSmolLM, isSmolLMLoaded } = await import('../llm/smolLM');
                if (isSmolLMLoaded('chat') || isSmolLMLoaded('tool')) {
                    logger.log('info', '[VoxtralSTT] Unloading main LLM to free memory for Voxtral...');
                    await releaseAllSmolLM();
                    logger.log('info', '[VoxtralSTT] Main LLM unloaded successfully');
                }
            } catch (e) {
                // Not critical — LLM might not be loaded
                logger.log('debug', '[VoxtralSTT] LLM unload skipped (not loaded or unavailable)');
            }

            // Find mmproj file (multimodal projector)
            // It should be in the same directory (voxtral-models)
            let mmprojPath: string | undefined;
            try {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');

                // If model path is absolute (desktop/file://), we try to assume mmproj is next to it
                // But on Android with "voxtral-models/..." relative path, we scan the dir.

                // Heuristic: list files in voxtral-models and find one ending in .mmproj or mmproj...gguf
                const result = await Filesystem.readdir({
                    path: 'voxtral-models',
                    directory: Directory.Data
                });

                // Prioritize file matching the model name, else any mmproj
                const modelName = config.modelPath.split('/').pop()?.replace('.gguf', '') || '';

                const candidates = result.files.map(f => f.name).filter(n =>
                    n.endsWith('.mmproj') || (n.includes('mmproj') && n.endsWith('.gguf'))
                );

                // 1. Try exact match (modelname.mmproj)
                // 2. Try generic names
                const exactMatch = candidates.find(n => n.includes(modelName));
                const anyMmproj = candidates[0];

                if (exactMatch) {
                    mmprojPath = `voxtral-models/${exactMatch}`;
                } else if (anyMmproj) {
                    mmprojPath = `voxtral-models/${anyMmproj}`;
                }

                if (mmprojPath) {
                    logger.log('info', `[VoxtralSTT] Found projector file: ${mmprojPath}`);
                } else {
                    logger.log('warn', '[VoxtralSTT] No .mmproj file found in voxtral-models. Initialization might fail if not inferred by backend.');
                }

            } catch (e) {
                logger.log('debug', '[VoxtralSTT] Failed to scan for mmproj', e);
            }

            // Initialize model
            const result = await Voxtral.initModel({
                modelPath: config.modelPath,
                mmprojPath: mmprojPath,
                transcriptionDelayMs: config.transcriptionDelayMs || 480,
                maxModelLen: config.maxModelLen || 45000,
                nThreads: config.nThreads || 4,
            });

            if (result.success) {
                this.isModelLoaded = true;
                this.currentModelPath = config.modelPath;
                logger.log('info', `Voxtral model loaded: ${config.modelPath} (delay: ${result.transcriptionDelayMs}ms)`);
            } else {
                throw new Error('Failed to initialize Voxtral model');
            }
        } catch (error) {
            logger.log('error', 'Failed to load Voxtral model', error);
            throw error;
        }
    }

    /**
     * Unload the current model
     */
    public async unloadModel(): Promise<void> {
        if (!this.isModelLoaded) {
            return;
        }

        logger.log('info', 'Unloading Voxtral model');

        try {
            // Stop streaming if running
            if (this.isStreaming) {
                await this.stop();
            }

            await Voxtral.unloadModel();
            this.isModelLoaded = false;
            this.currentModelPath = null;
            logger.log('info', 'Voxtral model unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload Voxtral model', error);
        }
    }

    /**
     * Check if a model is currently loaded
     */
    public checkModelLoaded(): boolean {
        return this.isModelLoaded;
    }

    /**
     * Get the currently loaded model path
     */
    public getCurrentModelPath(): string | null {
        return this.currentModelPath;
    }

    /**
     * Get model info
     */
    public async getModelInfo() {
        return await Voxtral.getModelInfo();
    }

    /**
     * Start real-time streaming transcription
     * @param onUpdate Callback that receives the accumulated transcript
     * @param _apiKey Optional API key (ignored)
     */
    public async start(
        onUpdate: (transcript: string, tokens: VoxtralToken[]) => void,
        _apiKey?: string
    ): Promise<void> {
        logger.log('info', `[VoxtralSTT] start() called. Model loaded: ${this.isModelLoaded}, isStreaming: ${this.isStreaming}`);

        if (!this.isModelLoaded) {
            logger.log('error', '[VoxtralSTT] No model loaded, throwing error');
            throw new Error('No Voxtral model loaded. Call loadModel() first.');
        }

        if (this.isStreaming) {
            logger.log('warn', 'Voxtral streaming already running');
            return;
        }

        logger.log('info', 'Starting Voxtral streaming');
        this.isStreaming = true;
        this.currentCallback = onUpdate;

        try {
            // Setup token listener
            this.tokenListener = await Voxtral.addListener('voxtralTokens', (data: { tokens: VoxtralToken[] }) => {
                if (data.tokens && data.tokens.length > 0) {
                    // Accumulate tokens
                    const newText = data.tokens.map(t => t.text).join('');
                    this.accumulatedTranscript += newText;

                    logger.log('info', `[VoxtralSTT] Received ${data.tokens.length} tokens: ${newText}`);

                    // Send update
                    if (this.currentCallback) {
                        this.currentCallback(this.accumulatedTranscript, data.tokens);
                    }
                }
            });

            // Setup error listener
            this.errorListener = await Voxtral.addListener('voxtralError', (data) => {
                logger.log('error', `[VoxtralSTT] Native error: code=${data.code} message=${data.message}`);
                if (this.onErrorCallback) {
                    this.onErrorCallback(data);
                }
            });

            // Start streaming
            await Voxtral.startRealtimeTranscription();

            logger.log('info', 'Voxtral streaming started');
        } catch (error) {
            this.isStreaming = false;
            this.currentCallback = null;
            logger.log('error', 'Failed to start Voxtral streaming', error);
            throw error;
        }
    }

    /**
     * Stop streaming transcription
     */
    public async stop(): Promise<void> {
        if (!this.isStreaming) {
            return;
        }

        logger.log('info', 'Stopping Voxtral streaming');

        try {
            await Voxtral.stopRealtimeTranscription();

            // Remove listeners
            if (this.tokenListener) {
                await this.tokenListener.remove();
                this.tokenListener = null;
            }
            if (this.errorListener) {
                await this.errorListener.remove();
                this.errorListener = null;
            }

            this.isStreaming = false;
            this.currentCallback = null;
            this.onErrorCallback = null;

            // Clear accumulated transcript
            this.accumulatedTranscript = '';

            logger.log('info', 'Voxtral streaming stopped');
        } catch (error) {
            logger.log('error', 'Failed to stop Voxtral streaming', error);
        }
    }

    /**
     * Check if streaming is currently running
     */
    public isRunning(): boolean {
        return this.isStreaming;
    }

    /**
     * Transcribe an audio file (batch mode)
     * @param audioPath Path to audio file
     * @returns Transcription result with segments
     */
    public async transcribeFile(audioPath: string): Promise<VoxtralTranscriptResult> {
        logger.log('info', `[VoxtralSTT] Transcribing file: ${audioPath}`);

        if (!this.isModelLoaded) {
            throw new Error('No Voxtral model loaded. Call loadModel() first.');
        }

        try {
            const result = await Voxtral.transcribeFile({ audioPath });

            if (result.success) {
                logger.log('info', `[VoxtralSTT] Transcription complete: ${result.transcript.length} chars`);
                return {
                    text: result.transcript,
                    segments: result.segments,
                };
            } else {
                throw new Error('Transcription failed');
            }
        } catch (error) {
            logger.log('error', '[VoxtralSTT] File transcription failed', error);
            throw error;
        }
    }
}

// Singleton instance
let _voxtralService: VoxtralSTTService | null = null;

/**
 * Get the singleton Voxtral STT service instance
 */
export const getVoxtralSttService = (): VoxtralSTTService => {
    if (!_voxtralService) {
        _voxtralService = new VoxtralSTTService();
    }
    return _voxtralService;
};
