declare module 'wakeword-capacitor' {
    export interface OpenWakeWordPlugin {
        startListening(options?: { modelName?: string; threshold?: number; cooldownMs?: number; bufferSize?: number }): Promise<{ status: string }>;
        stopListening(): Promise<void>;
        loadModel(options: { modelName: string; threshold?: number; cooldownMs?: number; bufferSize?: number; debug?: boolean }): Promise<{ loaded: boolean; modelName: string; inferenceTimeMs: number }>;
        unloadModel(): Promise<void>;
        isModelLoaded(): Promise<{ loaded: boolean }>;
        isListening(): Promise<{ listening: boolean }>;
        setThreshold(options: { threshold: number }): Promise<void>;
        setCooldown(options: { cooldownMs: number }): Promise<void>;
        setBufferSize(options: { bufferSize: number }): Promise<void>;
        startProcessing(): Promise<void>;
        stopProcessing(): Promise<void>;
        processAudio(options: { data: string }): Promise<void>;
        importModelZip(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;
        getAvailableModels(): Promise<{ models: Array<{ name: string; displayName: string; description: string; isDownloaded: boolean; fileSize?: number; path?: string }> }>;
        checkBaseModels(): Promise<{ hasMelSpectrogram: boolean; hasEmbedding: boolean }>;
        copyModelFile(options: { sourcePath: string; fileName: string }): Promise<{ path: string }>;
        deleteModel(options: { modelName: string; currentModel?: string }): Promise<void>;
        // Training APIs
        startTraining(): Promise<void>;
        stopTraining(): Promise<void>;
        clearTrainingData(): Promise<void>;
        getTrainingAudio(): Promise<{ audioBase64: string | null }>;
        saveProfile(options: { name: string }): Promise<void>;
        provideTrainingSample(options: { sample: string }): Promise<{ success: boolean }>;
        addListener(eventName: string, listenerFunc: (data: any) => void): Promise<{ remove: () => void }>;
    }

    const OpenWakeWord: OpenWakeWordPlugin;
    export { OpenWakeWord };
}
