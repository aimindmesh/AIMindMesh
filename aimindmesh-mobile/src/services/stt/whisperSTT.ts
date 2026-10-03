/**
 * Whisper STT Service
 * TypeScript wrapper for the whisper-capacitor native plugin.
 * Provides offline speech-to-text using Whisper.cpp models.
 */

import { logger } from '../logger';
import { ensureResident, isHeavyWhisperModel, markUnloaded } from '../model/modelOrchestrator';

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

export * from './whisperTypes';
import {
    WhisperSegment,
    WhisperTranscriptResult,
    WhisperConfig,
    WhisperDeviceInfo,
    WhisperStreamingSegment,
    whisperProfiles
} from './whisperTypes';

/**
 * Whisper STT Service
 */
export class WhisperSTTService {
    private _isModelLoaded = false;
    private currentModelId: string | null = null;
    private initialized = false;
    // Device-recommended thread count from getDeviceOptimization(); the native loadModel
    // ignores nThreads, so it has to be applied per transcription call.
    private recommendedThreads: number | null = null;

    constructor() {
        logger.log('info', 'WhisperSTTService initialized');
    }

    /**
     * Ensure the native plugin is initialized
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
     * Ensure Whisper is available, initializing if necessary
     */
    public async ensureAvailable(): Promise<boolean> {
        return await this.ensureInitialized();
    }

    /**
     * Load a Whisper model
     * @param modelId Model identifier (e.g., 'ggml-base', 'ggml-small') or full path
     */
    public async loadModel(modelId: string): Promise<void> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        logger.log('info', `Loading Whisper model: ${modelId}`);

        try {
            // Unload current model if loaded
            if (this._isModelLoaded) {
                await this.unloadModel();
            }

            // In Whisper.cpp plugin, modelPath can be relative to whisper-models or absolute;
            // a bare id is either `<id>.bin` or an imported bundle directory `<id>`
            let modelPath = modelId;
            if (!modelId.includes('/')) {
                const { resolveWhisperModelRelativePath } = await import('./whisperModelDownloader');
                const resolved = await resolveWhisperModelRelativePath(modelId);
                if (!resolved) {
                    throw new Error(`Whisper model ${modelId} not found. Please download it first.`);
                }
                modelPath = resolved;
            }

            // Memory coordination: a medium/large model frees the LLM (any engine) and other
            // heavy models first; tiny/base/small may stay next to the LLM
            await ensureResident('whisper', { heavy: isHeavyWhisperModel(modelId) });

            // Determine optimal thread count based on device
            const deviceInfo = await this.getDeviceOptimization();
            const nThreads = deviceInfo.recommendedThreads;
            this.recommendedThreads = nThreads;

            logger.log('info', `Using ${nThreads} threads for Whisper model (SoC: ${deviceInfo.soc})`);

            await Whisper.loadModel({
                modelPath,
                nThreads
            });

            this._isModelLoaded = true;
            this.currentModelId = modelId;
            logger.log('info', `Whisper model loaded successfully: ${modelId}`);
        } catch (error) {
            this._isModelLoaded = false;
            this.currentModelId = null;
            logger.log('error', `Failed to load Whisper model: ${modelId}`, error);
            throw error;
        }
    }

    /**
     * Unload the current model
     */
    public async unloadModel(): Promise<void> {
        const available = await this.ensureAvailable();
        if (!available || !this._isModelLoaded) {
            return;
        }

        try {
            await Whisper.unloadModel();
            this._isModelLoaded = false;
            this.currentModelId = null;
            markUnloaded('whisper');
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
            this._isModelLoaded = result.loaded;
            return result.loaded;
        } catch {
            return false;
        }
    }

    /**
     * Check if a model is loaded (synchronous property check)
     */
    public isModelLoaded(): boolean {
        return this._isModelLoaded;
    }

    private liveStreamManager: any = null;

    /**
     * Check if speech recognition is currently active
     */
    public isRecognitionActive(): boolean {
        return this.liveStreamManager?.isRunning() ?? false;
    }

    /**
     * Start live streaming speech recognition from microphone
     */
    public async start(
        onUpdate: (transcript: string) => void,
        _apiKey?: string,
        onAudioLevel?: (level: number) => void
    ): Promise<void> {
        const available = await this.ensureAvailable();
        if (!available) {
            throw new Error('Whisper plugin not available');
        }

        if (!this._isModelLoaded) {
            const { listLocalWhisperModels } = await import('./whisperModelDownloader');
            const models = await listLocalWhisperModels();
            if (models.length > 0) {
                await this.loadModel(models[0]);
            } else {
                throw new Error('No Whisper model loaded. Please download or select a Whisper model in Settings > Speech & Audio.');
            }
        }

        if (!this.liveStreamManager) {
            const { WhisperLiveStreamManager } = await import('./whisperLiveStream');
            this.liveStreamManager = new WhisperLiveStreamManager(this);
        }

        await this.liveStreamManager.start(onUpdate, onAudioLevel);
    }

    /**
     * Stop live streaming speech recognition
     */
    public async stop(): Promise<void> {
        if (this.liveStreamManager) {
            await this.liveStreamManager.stop();
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

        // The JS flag can be stale after a WebView reload while native still holds the model
        if (!this._isModelLoaded && !(await this.checkModelLoaded())) {
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

        // The JS flag can be stale after a WebView reload while native still holds the model
        if (!this._isModelLoaded && !(await this.checkModelLoaded())) {
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
            threads: (config as any).whisperThreads ?? this.recommendedThreads ?? 4, // Add threads support
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

        // The JS flag can be stale after a WebView reload while native still holds the model
        if (!this._isModelLoaded && !(await this.checkModelLoaded())) {
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

        // The JS flag can be stale after a WebView reload while native still holds the model
        if (!this._isModelLoaded && !(await this.checkModelLoaded())) {
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
                threads: (config as any).whisperThreads ?? this.recommendedThreads ?? 4,
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
