/**
 * Whisper STT Service
 * TypeScript wrapper for the whisper-capacitor native plugin.
 * Provides offline speech-to-text using Whisper.cpp models.
 */

import { logger } from '../logger';

// Plugin import will be available after native build
let Whisper: any = null;
let pluginInitialized = false;

// Initialize plugin asynchronously
async function initializeWhisperPlugin(): Promise<boolean> {
    if (pluginInitialized) return Whisper !== null;

    try {
        const module = await import('whisper-capacitor');
        Whisper = module.Whisper;
        pluginInitialized = true;
        logger.log('info', 'Whisper plugin loaded successfully');
        return true;
    } catch (error) {
        logger.log('warn', 'Whisper plugin not available', error);
        pluginInitialized = true;
        return false;
    }
}

/**
 * Whisper transcription result
 */
export interface WhisperTranscriptResult {
    text: string;
    segments: WhisperSegment[];
    processingTimeMs?: number;
}

/**
 * Individual transcript segment with timing
 */
export interface WhisperSegment {
    text: string;
    startMs: number;
    endMs: number;
}

/**
 * Whisper STT configuration
 * Extended parameters for optimal Italian transcription
 */
export interface WhisperConfig {
    language?: string;  // 'auto', 'en', 'it', etc.
    translate?: boolean; // Translate to English
    // Italian-optimized parameters
    temperature?: number;     // 0.0 = deterministic decoding (best for Italian)
    beamSize?: number;        // 5 = standard beam search for accuracy
    bestOf?: number;          // Number of candidates to evaluate
    initialPrompt?: string;   // Context prompt to reduce language mixing
    // VAD parameters
    vadFilter?: boolean;      // Enable silence filtering
    minSilenceDurationMs?: number; // Silence threshold for splitting
    speechPadMs?: number;     // Padding around speech segments
    // Quality settings  
    conditionOnPreviousText?: boolean; // Use previous context for better coherence
    wordTimestamps?: boolean; // Enable word-level timestamps
    chunkSize?: number;       // Chunk size in seconds for streaming
}

/**
 * Device optimization information from SoC detection.
 * Used to determine optimal thread count and recommended model.
 */
export interface WhisperDeviceInfo {
    soc: 'SNAPDRAGON_8_ELITE' | 'SNAPDRAGON_8_GEN_2' | 'UNKNOWN';
    availableCores: number;
    recommendedThreads: number;
    recommendedModel: string;
    deviceInfo: string;
}

/**
 * Segment callback data received during streaming transcription
 */
export interface WhisperStreamingSegment {
    text: string;
    startMs: number;
    endMs: number;
    segmentIndex: number;
}

/**
 * Whisper transcription profiles for different use cases
 */
export const whisperProfiles = {
    // Fast preview for real-time/hybrid mode (greedy decoding)
    fastPreview: {
        temperature: 0.0,
        beamSize: 1,
        bestOf: 1,
        vadFilter: false,
        conditionOnPreviousText: false,
        wordTimestamps: false
    } as WhisperConfig,

    // Maximum accuracy for post-processing
    maxAccuracy: {
        temperature: 0.0,
        beamSize: 5,
        bestOf: 5,
        vadFilter: true,
        minSilenceDurationMs: 1000,
        speechPadMs: 400,
        conditionOnPreviousText: true,
        wordTimestamps: true
    } as WhisperConfig,

    // Italian-specific prompts by profile
    italianPrompts: {
        fastPreview: 'Trascrizione in italiano.',
        maxAccuracy: 'Trascrizione professionale in italiano. Meeting di progetto con terminologia tecnica: task, issue, milestone, deploy, sprint, backlog.'
    }
};

/**
 * Whisper STT Service
 */
export class WhisperSTTService {
    private isModelLoaded = false;
    private currentModelId: string | null = null;
    private initialized = false;

    constructor() {
        logger.log('info', 'WhisperSTTService initialized');
    }

    /**
     * Ensure the Whisper plugin is initialized
     */
    private async ensureInitialized(): Promise<boolean> {
        if (this.initialized) return Whisper !== null;

        const result = await initializeWhisperPlugin();
        this.initialized = true;
        return result;
    }

    /**
     * Check if Whisper is available (native plugin installed)
     * Note: This is synchronous but may return false if not yet initialized.
     * Use ensureAvailable() for async check.
     */
    public isAvailable(): boolean {
        return Whisper !== null;
    }

    /**
     * Async check if Whisper is available (initializes plugin if needed)
     */
    public async ensureAvailable(): Promise<boolean> {
        await this.ensureInitialized();
        return Whisper !== null;
    }

    /**
     * Load a Whisper model
     * @param modelId Model ID from WHISPER_MODELS (e.g., 'ggml-base')
     */
    public async loadModel(modelId: string): Promise<void> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        try {
            // Log device optimization info on first model load
            if (!this.isModelLoaded) {
                const deviceInfo = await this.getDeviceOptimization();
                logger.log('info', '========== WHISPER DEVICE OPTIMIZATION ==========');
                logger.log('info', `Detected SoC: ${deviceInfo.soc}`);
                logger.log('info', `Available Cores: ${deviceInfo.availableCores}`);
                logger.log('info', `Recommended Threads: ${deviceInfo.recommendedThreads}`);
                logger.log('info', `Recommended Model: ${deviceInfo.recommendedModel}`);
                logger.log('info', '=================================================');
            }

            // Unload current model if different
            if (this.isModelLoaded && this.currentModelId !== modelId) {
                await this.unloadModel();
            }

            const modelPath = `whisper-models/${modelId}.bin`;
            logger.log('info', `Loading Whisper model: ${modelPath}`);

            await Whisper.loadModel({ modelPath });

            this.isModelLoaded = true;
            this.currentModelId = modelId;
            logger.log('info', 'Whisper model loaded successfully');
        } catch (error) {
            logger.log('error', `Failed to load Whisper model ${modelId}`, error);
            this.isModelLoaded = false;
            this.currentModelId = null;
            throw error;
        }
    }

    /**
     * Unload the current model
     */
    public async unloadModel(): Promise<void> {
        const available = await this.ensureAvailable();
        if (!available || !this.isModelLoaded) {
            return;
        }

        try {
            await Whisper.unloadModel();
            this.isModelLoaded = false;
            this.currentModelId = null;
            logger.log('info', 'Whisper model unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload Whisper model', error);
        }
    }

    /**
     * Check if a model is loaded
     */
    public async checkModelLoaded(): Promise<boolean> {
        const available = await this.ensureAvailable();
        if (!available) {
            return false;
        }

        try {
            const result = await Whisper.isModelLoaded();
            this.isModelLoaded = result.loaded;
            return result.loaded;
        } catch {
            return false;
        }
    }

    /**
     * Get the currently loaded model ID
     */
    public getCurrentModelId(): string | null {
        return this.currentModelId;
    }

    /**
     * Get device optimization information.
     * Returns SoC detection, recommended threads, and model.
     */
    public async getDeviceOptimization(): Promise<WhisperDeviceInfo> {
        const available = await this.ensureAvailable();
        if (!available) {
            // Return unknown defaults if plugin not available
            return {
                soc: 'UNKNOWN',
                availableCores: 4,
                recommendedThreads: 4,
                recommendedModel: 'ggml-tiny-q5_1',
                deviceInfo: 'Plugin not available'
            };
        }

        try {
            const result = await Whisper.getDeviceOptimization();
            logger.log('info', 'Device optimization:', result);
            return {
                soc: result.soc || 'UNKNOWN',
                availableCores: result.availableCores || 4,
                recommendedThreads: result.recommendedThreads || 4,
                recommendedModel: result.recommendedModel || 'ggml-tiny-q5_1',
                deviceInfo: result.deviceInfo || ''
            };
        } catch (error) {
            logger.log('error', 'Failed to get device optimization', error);
            return {
                soc: 'UNKNOWN',
                availableCores: 4,
                recommendedThreads: 4,
                recommendedModel: 'ggml-tiny-q5_1',
                deviceInfo: 'Error fetching device info'
            };
        }
    }

    /**
     * Transcribe an audio file
     * @param audioPath Path to audio file (relative to app data directory)
     * @param config Transcription configuration
     */
    public async transcribeFile(
        audioPath: string,
        config: WhisperConfig = {}
    ): Promise<WhisperTranscriptResult> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No Whisper model loaded. Call loadModel first.');
        }

        logger.log('info', `Transcribing file: ${audioPath}`);

        try {
            const result = await Whisper.transcribe({
                audioPath,
                language: config.language || 'auto',
                translate: config.translate || false
            });

            return {
                text: result.text || '',
                segments: result.segments || [],
                processingTimeMs: result.processingTimeMs
            };
        } catch (error) {
            logger.log('error', 'Whisper transcription failed', error);
            throw error;
        }
    }

    /**
     * Transcribe raw audio data (PCM 16kHz mono)
     * @param audioData Base64 encoded PCM audio data
     * @param config Transcription configuration
     */
    public async transcribeAudio(
        audioData: string,
        config: WhisperConfig = {},
        profile: 'fast' | 'accurate' = 'accurate'
    ): Promise<WhisperTranscriptResult> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No Whisper model loaded. Call loadModel first.');
        }

        const language = config.language || 'auto';
        const isItalian = language === 'it';

        // Select profile-based defaults
        const profileConfig = profile === 'fast'
            ? whisperProfiles.fastPreview
            : whisperProfiles.maxAccuracy;

        // Get Italian prompt based on profile
        const italianPrompt = profile === 'fast'
            ? whisperProfiles.italianPrompts.fastPreview
            : whisperProfiles.italianPrompts.maxAccuracy;

        // Merge profile defaults with explicit config (explicit config wins)
        const transcribeParams = {
            audioData,
            language,
            // Apply profile defaults, override with explicit config
            temperature: (config as any).whisperTemperature ?? config.temperature ?? profileConfig.temperature ?? 0.0,
            beamSize: (config as any).whisperBeamSize ?? config.beamSize ?? profileConfig.beamSize ?? 5,
            bestOf: (config as any).whisperBestOf ?? config.bestOf ?? profileConfig.bestOf ?? 1,
            threads: (config as any).whisperThreads ?? 4, // Add threads support
            initialPrompt: config.initialPrompt ?? (isItalian ? italianPrompt : ''),
            // VAD parameters
            vadFilter: config.vadFilter ?? profileConfig.vadFilter ?? false,
            minSilenceDurationMs: config.minSilenceDurationMs ?? profileConfig.minSilenceDurationMs ?? 500,
            speechPadMs: config.speechPadMs ?? profileConfig.speechPadMs ?? 400,
            // Quality settings
            conditionOnPreviousText: config.conditionOnPreviousText ?? profileConfig.conditionOnPreviousText ?? false,
            wordTimestamps: config.wordTimestamps ?? profileConfig.wordTimestamps ?? false
        };

        logger.log('debug', `Transcribing audio [profile=${profile}, lang=${language}]`, {
            beamSize: transcribeParams.beamSize,
            threads: transcribeParams.threads,
            vadFilter: transcribeParams.vadFilter
        });

        try {
            const result = await Whisper.transcribeAudio(transcribeParams);

            return {
                text: result.text || '',
                segments: result.segments || []
            };
        } catch (error) {
            logger.log('error', 'Whisper audio transcription failed', error);
            throw error;
        }
    }

    /**
     * Transcribe an audio file using streaming (chunked) mode
     * @param audioPath Path to audio file
     * @param onChunk Callback for partial results
     * @param config Transcription configuration
     */
    public async transcribeFileStream(
        audioPath: string,
        onChunk: (data: { text: string; segments: WhisperSegment[]; isFinal: boolean; chunkIndex: number }) => void,
        config: WhisperConfig = {}
    ): Promise<WhisperTranscriptResult> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No Whisper model loaded. Call loadModel first.');
        }

        logger.log('info', `Transcribing file (stream): ${audioPath}`);

        // Accumulate full text and segments
        const allSegments: WhisperSegment[] = [];
        let fullText = '';

        // Keep track of processed chunks to avoid duplicates if any
        const processedChunks = new Set<number>();

        try {
            // Setup listener
            const listener = await Whisper.addListener('transcriptionChunk', (chunk: any) => {
                logger.log('debug', `Received chunk ${chunk.chunkIndex}`);

                if (processedChunks.has(chunk.chunkIndex)) return;
                processedChunks.add(chunk.chunkIndex);

                const chunkText = chunk.text || '';
                const chunkSegments = chunk.segments || [];

                // Pass this chunk's data to callback
                onChunk({
                    text: chunkText,
                    segments: chunkSegments,
                    isFinal: false,
                    chunkIndex: chunk.chunkIndex
                });
            });

            const result = await Whisper.transcribeStream({
                audioPath,
                language: config.language || 'auto',
                chunkSize: (config as any).chunkSize || 20
            });

            // Cleanup listener
            await listener.remove();

            // Process final result to build complete return object
            if (result.chunks) {
                result.chunks.forEach((c: any) => {
                    fullText += (c.text || '');
                    if (c.segments) {
                        allSegments.push(...c.segments);
                    }
                });
            }

            // Final callback
            onChunk({
                text: fullText,
                segments: allSegments,
                isFinal: true,
                chunkIndex: -1
            });

            return {
                text: fullText,
                segments: allSegments,
                processingTimeMs: 0
            };
        } catch (error) {
            logger.log('error', 'Whisper streaming transcription failed', error);
            throw error;
        }
    }

    /**
     * Transcribe audio with live segment streaming.
     * Segments are sent to the callback as they are transcribed,
     * allowing real-time text display in the UI.
     * 
     * @param audioData Base64 encoded PCM audio data (16kHz mono)
     * @param onSegment Callback called for each transcribed segment
     * @param config Transcription configuration
     * @returns Final transcription result after all segments are processed
     */
    public async transcribeAudioWithLiveSegments(
        audioData: string,
        onSegment: (segment: WhisperStreamingSegment) => void,
        config: WhisperConfig = {}
    ): Promise<WhisperTranscriptResult> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        if (!this.isModelLoaded) {
            throw new Error('No Whisper model loaded. Call loadModel first.');
        }

        const language = config.language || 'auto';
        const isItalian = language === 'it';

        logger.log('info', `Starting live streaming transcription [lang=${language}]`);

        // Setup segment listener
        const segmentListener = await Whisper.addListener(
            'transcriptionSegment',
            (data: WhisperStreamingSegment) => {
                logger.log('debug', `Segment ${data.segmentIndex}: ${data.text}`);
                onSegment(data);
            }
        );

        try {
            const transcribeParams = {
                audioData,
                language,
                temperature: (config as any).whisperTemperature ?? config.temperature ?? 0.0,
                beamSize: (config as any).whisperBeamSize ?? config.beamSize ?? 1, // Greedy for speed
                bestOf: (config as any).whisperBestOf ?? config.bestOf ?? 1,
                threads: (config as any).whisperThreads ?? 4,
                initialPrompt: config.initialPrompt ?? (isItalian ? whisperProfiles.italianPrompts.fastPreview : ''),
                vadFilter: config.vadFilter ?? false,
                conditionOnPreviousText: config.conditionOnPreviousText ?? false
            };

            const result = await Whisper.transcribeAudioStreaming(transcribeParams);

            return {
                text: result.text || '',
                segments: result.segments || []
            };
        } finally {
            // Always cleanup listener
            await segmentListener.remove();
        }
    }

    /**
     * Post-process Vosk transcription with Whisper for better accuracy
     * @param audioPath Path to the audio file
     * @param voskTranscript Original Vosk transcript for reference
     */
    public async refineTranscription(
        audioPath: string,
        _voskTranscript: string
    ): Promise<WhisperTranscriptResult> {
        // Simply transcribe with Whisper - it should produce better results
        return this.transcribeFile(audioPath, { language: 'auto' });
    }
}

// Singleton instance
let _whisperService: WhisperSTTService | null = null;

/**
 * Get the singleton Whisper STT service
 */
export function getWhisperSTTService(): WhisperSTTService {
    if (!_whisperService) {
        _whisperService = new WhisperSTTService();
    }
    return _whisperService;
}
