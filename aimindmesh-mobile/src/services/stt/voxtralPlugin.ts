import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface VoxtralPlugin {
    /**
     * Initialize Voxtral model
     */
    initModel(options: {
        modelPath: string;
        mmprojPath?: string; // Path to multimodal projector
        transcriptionDelayMs?: number; // 240, 480, 960, 2400
        maxModelLen?: number; // Default 45000
        nThreads?: number; // Default 4
    }): Promise<{ success: boolean; modelPath: string; transcriptionDelayMs: number }>;

    /**
     * Start real-time streaming transcription
     */
    startRealtimeTranscription(): Promise<{ streaming: boolean }>;

    /**
     * Stop real-time streaming
     */
    stopRealtimeTranscription(): Promise<{ streaming: boolean }>;

    /**
     * Transcribe audio file (batch mode)
     */
    transcribeFile(options: {
        audioPath: string;
    }): Promise<{
        success: boolean;
        transcript: string;
        segments: Array<{
            text: string;
            start: number;
            end: number;
            confidence: number;
        }>;
    }>;

    /**
     * Unload model from memory
     */
    unloadModel(): Promise<{ unloaded: boolean }>;

    /**
     * Reset transcription context (KV cache, audio buffer, token queue)
     */
    resetContext(): Promise<{ reset: boolean }>;

    /**
     * Get model info
     */
    getModelInfo(): Promise<{
        loaded: boolean;
        modelPath?: string;
        modelName?: string;
        parameters?: number;
        transcriptionDelayMs?: number;
        memoryUsageMB?: number;
    }>;

    /**
     * Copy file to voxtral-models directory (for import)
     */
    copyFile(options: {
        sourcePath: string;
        fileName: string;
    }): Promise<{ path: string }>;

    /**
     * Add event listener
     */
    addListener(
        eventName: 'voxtralTokens',
        listenerFunc: (data: any) => void
    ): Promise<PluginListenerHandle>;

    /**
     * Add error event listener
     */
    addListener(
        eventName: 'voxtralError',
        listenerFunc: (data: { code: number; message: string }) => void
    ): Promise<PluginListenerHandle>;
}

const Voxtral = registerPlugin<VoxtralPlugin>('Voxtral');

export default Voxtral;
