/**
 * LiteRT LLM Inference API - Capacitor Plugin Definitions
 * 
 * This plugin provides access to Google's LiteRT LLM Inference API
 * for on-device inference with Gemma models.
 */
import type { PluginListenerHandle } from '@capacitor/core';

export interface LiteRTToolDefinition {
    /** Tool name (must be unique) */
    name: string;
    /** Description of what the tool does */
    description: string;
    /** JSON Schema for the tool's parameters */
    parameters: Record<string, unknown>;
}

export interface LiteRTInitOptions {
    /** Path to the .litertlm or .task model file */
    modelPath: string;
    /** Maximum number of tokens to generate (default: 1024) */
    maxTokens?: number;
    /** Sampling temperature (default: 0.8) */
    temperature?: number;
    /** Top-K sampling (default: 40) */
    topK?: number;
    topP?: number;
    backend?: 'CPU' | 'GPU';
    useNPU?: boolean;  // Enable Qualcomm QNN/Hexagon NPU delegate (requires Snapdragon SoC)
    enableVision?: boolean;
    enableAudio?: boolean;
    maxNumImages?: number;
    /** Enable native tool calling (LiteRT v0.14+) */
    enableToolCalling?: boolean;
    /** Tool definitions for native function calling (LiteRT v0.14+) */
    tools?: LiteRTToolDefinition[];
}



export interface LiteRTGenerateOptions {
    /** Text prompt */
    prompt: string;
    /** Optional base64 encoded images (data:image/...) */
    images?: string[];
    /** Stream tokens as they are generated */
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
    /** Native tool calls from LiteRT v0.14+ function calling */
    toolCalls?: Array<{
        name: string;
        args: Record<string, unknown>;
    }>;
}

export interface LiteRTTokenEvent {
    token: string;
    done: boolean;
}

export interface LiteRTPlugin {
    /**
     * Initialize LiteRT LLM with a model file
     */
    initModel(options: LiteRTInitOptions): Promise<LiteRTInitResult>;


    /**
     * Generate a response (non-streaming)
     */
    generateResponse(options: LiteRTGenerateOptions): Promise<LiteRTGenerateResult>;

    /**
     * Generate a response from the LLM with streaming.
     * Returns a CallbackID that can be used to clear the watcher.
     */
    generateResponseStream(options: LiteRTGenerateOptions, callback: (result: LiteRTGenerateResult) => void): Promise<string>;

    /**
     * Stop the current generation
     */
    stopGeneration(): Promise<void>;



    /**
     * Release the model and free resources
     */
    releaseModel(): Promise<void>;

    /**
     * Check if a model is currently loaded
     */
    isModelLoaded(): Promise<{ loaded: boolean }>;

    /**
     * Register tool definitions for native function calling (LiteRT v0.14+).
     * Must be called after initModel and before generateResponse/Stream.
     */
    registerTools(options: { tools: LiteRTToolDefinition[] }): Promise<{ success: boolean }>;

    /**
     * Add a listener for token streaming events
     */
    addListener(
        eventName: 'liteRTToken',
        listener: (event: LiteRTTokenEvent) => void
    ): Promise<PluginListenerHandle>;

    /**
     * Save current conversation KV cache to disk
     */
    saveKvCache(options: { conversationId: string }): Promise<{ success: boolean }>;

    /**
     * Restore conversation KV cache from disk
     */
    restoreKvCache(options: { conversationId: string }): Promise<{ success: boolean; messageCount?: number }>;

    /**
     * Invalidate/delete conversation KV cache from disk
     */
    invalidateKvCache(options: { conversationId: string }): Promise<{ success: boolean }>;

    /**
     * Release conversation session
     */
    releaseSession(): Promise<void>;

    /**
     * Get current message count
     */
    getMessageCount(): Promise<{ count: number }>;
}
