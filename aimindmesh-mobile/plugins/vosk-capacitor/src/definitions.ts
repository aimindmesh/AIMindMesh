import type { PluginListenerHandle } from '@capacitor/core';

export interface PermissionStatus {
    microphone: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
}

export interface VoskPlugin {
    /**
     * Check permission status
     */
    checkPermissions(): Promise<PermissionStatus>;

    /**
     * Request permissions
     */
    requestPermissions(): Promise<PermissionStatus>;

    /**
     * Load a Vosk model from the app's data directory
     * @param options.modelPath Relative path to model directory (e.g., 'vosk-models/vosk-model-en-us-0.22-lgraph')
     */
    loadModel(options: { modelPath: string }): Promise<void>;

    /**
     * Unload the currently loaded model and release resources
     */
    unloadModel(): Promise<void>;

    /**
     * Load a Vosk speaker model for speaker diarization
     * @param options.modelPath Relative path to speaker model directory (e.g., 'vosk-model-spk-0.4')
     */
    loadSpeakerModel(options: { modelPath: string }): Promise<void>;

    /**
     * Unload the speaker model and release resources
     */
    unloadSpeakerModel(): Promise<void>;

    /**
     * Check if a speaker model is currently loaded
     */
    isSpeakerModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Start continuous speech recognition
     * Results will be delivered through event listeners
     */
    startRecognition(): Promise<void>;

    /**
     * Stop speech recognition
     */
    stopRecognition(): Promise<void>;

    /**
     * Check if a model is currently loaded
     */
    isModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Get information about the currently loaded model
     */
    getModelInfo(): Promise<{ modelPath: string | null; language: string | null }>;

    /**
   * Download a Vosk model from a URL
   */
    downloadModel(options: { url: string; path: string }): Promise<{ path: string }>;

    /**
     * Copy a file from device storage to app data directory
     * Handles content:// URIs from FilePicker
     */
    copyFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;

    /**
     * Listen for download progress
     */
    addListener(
        eventName: 'downloadProgress',
        listenerFunc: (progress: { progress: number }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for partial recognition results (interim results while speaking)
     */
    addListener(
        eventName: 'partialResult',
        listenerFunc: (result: { text: string }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for final recognition results (complete utterance)
     * Includes optional speaker vector when speaker model is loaded
     */
    addListener(
        eventName: 'finalResult',
        listenerFunc: (result: FinalResultEvent) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for recognition errors
     */
    addListener(
        eventName: 'error',
        listenerFunc: (error: { message: string }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for audio level updates (0-1)
     */
    addListener(
        eventName: 'audioLevel',
        listenerFunc: (result: { level: number }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Start manual processing mode (no microphone)
     */
    startProcessing(): Promise<void>;

    /**
     * Submit audio data for processing (Base64 encoded PCM 16bit mono 16kHz)
     */
    submitAudio(options: { data: string }): Promise<void>;

    /**
     * Stop processing and release resources
     */
    stopProcessing(): Promise<void>;

    /**
     * Remove all listeners for this plugin
     */
    removeAllListeners(): Promise<void>;
}

/**
 * Final result event with optional speaker embedding vector
 */
export interface FinalResultEvent {
    /** Recognized text */
    text: string;
    /** Speaker embedding vector (128-dimensional) when speaker model is loaded */
    speakerVector?: number[];
}
