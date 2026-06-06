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

/**
 * Whisper plugin interface for Capacitor
 */
export interface WhisperPlugin {
    /**
     * Load a Whisper GGML model from the app's data directory
     * @param options.modelPath Relative path to model file (e.g., 'whisper-models/ggml-base.bin')
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
