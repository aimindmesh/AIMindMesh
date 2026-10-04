import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Whisper transcription segment with timing
 */
export interface TranscriptSegment {
    /** Recognized text */
    text: string;
    /** Start time in milliseconds */
    startMs: number;
    /** End time in milliseconds */
    endMs: number;
    /** Confidence score (0-1) if available */
    confidence?: number;
}

export interface WhisperOptimizationResult {
    soc: string;
    availableCores: number;
    recommendedThreads: number;
    recommendedModel: string;
    hasNpu?: boolean;
    npuArch?: string;
    recommendedBackend?: 'npu' | 'cpu';
    deviceInfo: string;
}

/**
 * Whisper plugin interface for Capacitor
 */
export interface WhisperPlugin {
    /**
     * Load a Whisper GGML / QNN model from the app's data directory
     * @param options.modelPath Relative path to model file (e.g., 'whisper-models/ggml-base.bin')
     * @param options.useNPU Optional flag to enable Qualcomm Hexagon NPU offload
     */
    loadModel(options: { modelPath: string; useNPU?: boolean; backend?: 'npu' | 'cpu' }): Promise<void>;

    /**
     * Get device optimization info including NPU capabilities
     */
    getDeviceOptimization(): Promise<WhisperOptimizationResult>;

    /**
     * Unload the currently loaded model and release resources
     */
    unloadModel(): Promise<void>;

    /**
     * Check if a model is currently loaded
     */
    isModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Transcribe an audio file (post-processing mode)
     * @param options.audioPath Path to audio file (WAV, 16kHz, mono)
     * @param options.language Language code (e.g., 'en', 'it', 'auto')
     * @param options.translate If true, translate to English
     */
    transcribe(options: {
        audioPath: string;
        language?: string;
        translate?: boolean;
    }): Promise<{
        text: string;
        segments: TranscriptSegment[];
        processingTimeMs: number;
    }>;

    /**
     * Transcribe [startMs, endMs) of a 16 kHz mono WAV file, reading only that range.
     * Segment times are relative to the start of the file. Calls run one at a time.
     * @param options.beamSize 1 = greedy (fast), 5 = beam search (more accurate, ~2-3x slower)
     * @param options.initialPrompt Text that precedes the range (e.g. the previous chunk), for continuity
     */
    transcribeRange(options: {
        audioPath: string;
        startMs: number;
        endMs: number;
        language?: string;
        threads?: number;
        beamSize?: number;
        initialPrompt?: string;
        /** Encoder frames (1500 = 30 s); 0 = full window. Smaller is faster on short ranges. */
        audioCtx?: number;
    }): Promise<{
        text: string;
        segments: TranscriptSegment[];
        /** Language used: the one requested, or the one detected with 'auto' */
        language: string;
        processingTimeMs: number;
    }>;

    /** Stop the running transcription as soon as possible. */
    abort(): Promise<void>;

    /**
     * Copy a file from a source URI (e.g. content://) to a destination filename in the app's files directory
     * @param options.sourcePath Source URI
     * @param options.fileName Destination filename (relative to files dir)
     */
    copyFile(options: {
        sourcePath: string;
        fileName: string;
    }): Promise<{ path: string }>;

    /**
     * Transcribe raw audio data (Base64 encoded PCM 16bit mono 16kHz)
     * @param options.audioData Base64 encoded audio data
     * @param options.language Language code
     */
    transcribeAudio(options: {
        audioData: string;
        language?: string;
    }): Promise<{
        text: string;
        segments: TranscriptSegment[];
    }>;

    /**
     * Listen for transcription progress
     */
    addListener(
        eventName: 'progress',
        listenerFunc: (progress: { percentage: number }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for errors
     */
    addListener(
        eventName: 'error',
        listenerFunc: (error: { message: string }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Remove all listeners for this plugin
     */
    removeAllListeners(): Promise<void>;

    /**
     * Transcribe an audio file in chunks (streaming mode)
     */
    transcribeStream(options: {
        audioPath: string;
        language?: string;
        chunkSize?: number; // seconds, default 20
    }): Promise<{
        complete: boolean;
        chunks: {
            chunkIndex: number;
            text: string;
            segments: TranscriptSegment[];
            startTime: number;
        }[];
    }>;

    /**
     * Listen for transcription chunks
     */
    addListener(
        eventName: 'transcriptionChunk',
        listenerFunc: (result: {
            chunkIndex: number;
            text: string;
            segments: TranscriptSegment[];
            startTime: number;
        }) => void,
    ): Promise<PluginListenerHandle>;
}
