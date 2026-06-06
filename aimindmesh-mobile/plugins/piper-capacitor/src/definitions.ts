import type { PluginListenerHandle } from '@capacitor/core';

export interface PiperPlugin {
    /**
     * Load a Piper voice model
     * @param options.modelPath Relative path to .onnx model file (e.g., 'piper-voices/it_IT-paola-medium.onnx')
     * @param options.configPath Relative path to .json config file (e.g., 'piper-voices/it_IT-paola-medium.onnx.json')
     */
    loadVoice(options: { modelPath: string; configPath: string }): Promise<void>;

    /**
     * Unload the currently loaded voice
     */
    unloadVoice(): Promise<void>;

    /**
     * Synthesize text to speech
     * @param options.text Text to synthesize (optional if phonemeIds provided)
     * @param options.phonemeIds Array of phoneme IDs (optional if text provided)
     * @returns Path to the generated audio file
     */
    synthesize(options: { text?: string; phonemeIds?: number[] }): Promise<{ audioPath: string }>;

    /**
     * Speak text directly (synthesize + play)
     * @param options.text Text to speak (optional if phonemeIds provided)
     * @param options.phonemeIds Array of phoneme IDs (optional if text provided)
     */
    speak(options: { text?: string; phonemeIds?: number[] }): Promise<void>;

    /**
     * Download a Piper voice model
     */
    downloadVoice(options: { url: string; path: string }): Promise<{ path: string }>;

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
     * Listen for sentence synthesis start (streaming TTS)
     * Fired when beginning synthesis of each sentence in streaming mode
     */
    addListener(
        eventName: 'sentenceStart',
        listenerFunc: (data: { sentenceIndex: number; sentence: string }) => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Listen for synthesis complete (streaming TTS)
     */
    addListener(
        eventName: 'synthesisComplete',
        listenerFunc: () => void,
    ): Promise<PluginListenerHandle>;

    /**
     * Stop current playback
     */
    stop(): Promise<void>;

    /**
     * Check if a voice is currently loaded
     */
    isVoiceLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Get information about the currently loaded voice
     */
    /**
     * Get information about the currently loaded voice
     */
    getVoiceInfo(): Promise<{ voiceId: string | null }>;

    /**
     * Set the audio output device
     * @param options.output The output device type ('speaker', 'earpiece', 'bluetooth', 'wired')
     */
    setAudioOutput(options: { output: AudioOutput }): Promise<void>;

    /**
     * Get available audio output devices
     */
    getAvailableAudioOutputs(): Promise<{ outputs: AudioOutput[] }>;
}

export type AudioOutput = 'speaker' | 'earpiece' | 'bluetooth' | 'wired';
