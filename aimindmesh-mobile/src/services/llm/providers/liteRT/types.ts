import { PluginListenerHandle } from '@capacitor/core';

export interface LiteRTInitOptions {
    modelPath: string;
    maxTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
    backend?: 'CPU' | 'GPU';
    enableVision?: boolean;
    enableAudio?: boolean;
    randomSeed?: number;
    maxNumImages?: number;
    useVisionGpu?: boolean;  // Dynamic vision backend: GPU when images present, CPU otherwise
    storeChats?: boolean;    // Whether to persist conversation history in native layer
    useNPU?: boolean;        // Qualcomm QNN/Hexagon NPU delegate (requires Snapdragon SoC)
    enableMtp?: boolean;     // Multi-Token Prediction (Speculative Decoding)
}

export interface LiteRTSessionOptions {
    topK?: number;
    temperature?: number;
    enableVision?: boolean;
    enableAudio?: boolean;
}

export interface LiteRTGenerateOptions {
    prompt: string;
    images?: string[];
    audio?: string[];
    stream?: boolean;
}

export interface LiteRTInitResult {
    success: boolean;
    error?: string;
    modelInfo?: {
        supportsVision: boolean;
        supportsAudio: boolean;
    };
}

export interface LiteRTGenerateResult {
    text: string;
    done: boolean;
    error?: string;
    thinkingText?: string;
}

export interface LiteRTTokenEvent {
    token: string;
    done: boolean;
}

export interface LiteRTPlugin {
    initModel(options: LiteRTInitOptions): Promise<LiteRTInitResult>;
    createSession(options?: LiteRTSessionOptions): Promise<{ sessionId: string }>;
    generateResponse(options: LiteRTGenerateOptions): Promise<LiteRTGenerateResult>;
    generateResponseStream(options: LiteRTGenerateOptions, callback: (result: LiteRTGenerateResult, err?: any) => void): Promise<string>;
    stopGeneration(): Promise<void>;
    releaseSession(): Promise<void>;
    releaseModel(): Promise<void>;
    isModelLoaded(): Promise<{ isLoaded: boolean; modelPath?: string }>;
    getMessageCount(): Promise<{ count: number }>;
    saveKvCache(options: { conversationId: string }): Promise<{ success: boolean }>;
    restoreKvCache(options: { conversationId: string }): Promise<{ success: boolean; messageCount: number }>;
    invalidateKvCache(options: { conversationId: string }): Promise<{ success: boolean }>;
    addListener(
        eventName: 'liteRTToken',
        listener: (event: LiteRTTokenEvent) => void
    ): Promise<PluginListenerHandle>;
}

export interface LiteRTConfig {
    modelPath: string;
    maxTokens?: number;
    temperature?: number;
    topK?: number;
    topP?: number;
    backend?: 'CPU' | 'GPU';
    enableVision?: boolean;
    enableAudio?: boolean;
    storeChats?: boolean;
    useNPU?: boolean;        // Qualcomm QNN/Hexagon NPU delegate (requires Snapdragon SoC)
    enableMtp?: boolean;
}
