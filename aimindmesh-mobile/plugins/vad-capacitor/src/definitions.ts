import type { PluginListenerHandle } from '@capacitor/core';

/**
 * VAD result for a single audio chunk
 */
export interface VADResult {
    /** Whether speech is detected */
    isSpeech: boolean;
    /** Confidence score (0-1) */
    confidence: number;
    /** Timestamp when speech started (ms), if applicable */
    speechStartMs?: number;
    /** Timestamp when speech ended (ms), if applicable */
    speechEndMs?: number;
}

/**
 * Speech segment detected by VAD
 */
export interface SpeechSegment {
    /** Start time in milliseconds */
    startMs: number;
    /** End time in milliseconds */
    endMs: number;
    /** Duration in milliseconds */
    durationMs: number;
}

/**
 * VAD plugin interface for Capacitor
 */
export interface VADPlugin {
    /**
     * Load a Silero VAD model from the app's data directory
     * @param options.modelPath Relative path to ONNX model file (e.g., 'vad-models/silero-vad-v4.onnx')
     */
    loadModel(options: { modelPath: string }): Promise<void>;

    /**
     * Unload the currently loaded model and release resources
     */
    unloadModel(): Promise<void>;

    /**
     * Check if a model is currently loaded
     */
    isModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Configure VAD thresholds
     * @param options.speechThreshold Threshold for speech detection (0-1), default 0.5
     * @param options.silenceDurationMs Duration of silence to end speech segment (ms), default 300
     * @param options.minSpeechDurationMs Minimum speech duration to report (ms), default 250
     */
    setThresholds(options: {
        speechThreshold?: number;
        silenceDurationMs?: number;
        minSpeechDurationMs?: number;
    }): Promise<void>;

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
     * Process audio samples for VAD (streaming mode)
     * @param options.samples Base64 encoded audio samples (Float32, 16kHz mono)
     * @returns VAD result for this chunk
     */
    processSamples(options: { samples: string }): Promise<VADResult>;

    /**
     * Process entire audio file and get speech segments
     * @param options.audioPath Path to audio file (WAV, 16kHz mono)
     * @returns Array of speech segments
     */
    processFile(options: { audioPath: string }): Promise<{ segments: SpeechSegment[] }>;

    /**
     * Reset VAD state (call between recordings)
     */
    reset(): Promise<void>;

    /**
     * Listen for speech start events (streaming mode)
     */
    addListener(
        eventName: 'speechStart',
        listenerFunc: (result: { timestampMs: number }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for speech end events (streaming mode)
     */
    addListener(
        eventName: 'speechEnd',
        listenerFunc: (result: { timestampMs: number; durationMs: number }) => void,
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
}
