/**
 * SmolLM Service - High-performance LLM inference based on SmolChat-Android architecture
 * 
 * This service provides real token-by-token streaming using the new SmolLM native layer,
 * replacing the simulated chunking approach with proper native streaming.
 */

import { registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { logger } from '../logger';
import type {
    SmolLMInitResult,
    SmolLMCompletionResult,
    SmolLMTokenEvent,
    SmolLMMetrics
} from 'llama-cpp-capacitor';
import { thermalThrottlingService } from '../performance/thermalThrottlingService';

// Register the plugin
const LlamaCpp = registerPlugin('LlamaCpp') as any;

// =========================================================================
// Types
// =========================================================================

export interface SmolLMConfig {
    modelPath: string;
    temperature?: number;
    minP?: number;
    contextSize?: number;
    numThreads?: number;
    useMmap?: boolean;
    useMlock?: boolean;
    useVulkan?: boolean;     // GPU acceleration via Vulkan (optional, requires device support)
    useOpenCL?: boolean;     // OpenCL backend, optimized for Qualcomm Adreno GPUs (Z Fold 5/7)
    storeChats?: boolean;
    chatTemplate?: string;
    systemPrompt?: string;
}

export interface SmolLMGenerateOptions {
    prompt: string;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
}

export interface SmolLMResponse {
    text: string;
    tokensPerSecond: number;
    contextUsed: number;
    interrupted: boolean;
}

// =========================================================================
// State Management
// =========================================================================

type SmolLMSlot = 'chat' | 'tool';

interface SmolLMContext {
    contextId: number;
    modelPath: string;
    isLoaded: boolean;
}

const smolLMContexts: Map<SmolLMSlot, SmolLMContext> = new Map();
let tokenListener: PluginListenerHandle | null = null;
const tokenCallbacks: Map<number, (token: string) => void> = new Map();

// =========================================================================
// Core Functions
// =========================================================================

/**
 * Initialize a SmolLM model for high-performance streaming inference.
 * Uses the new architecture based on SmolChat-Android for real token streaming.
 */
export async function initSmolLM(
    config: SmolLMConfig,
    slot: SmolLMSlot = 'chat'
): Promise<void> {
    // Release existing context in this slot
    const existing = smolLMContexts.get(slot);
    if (existing?.isLoaded) {
        await releaseSmolLM(slot);
    }

    logger.log('debug', `[SmolLM] Initializing ${slot} model:`, config.modelPath);



    // Default to useVulkan if requested and not explicitly disabled
    let useVulkan = config.useVulkan ?? false;

    // Check thermal tier for Vulkan fallback (PERF-001)
    if (useVulkan) {
        const currentTier = thermalThrottlingService.getCurrentTier();
        if (currentTier === 'VERY_HOT' || currentTier === 'CRITICAL') {
            logger.log('warn', `[SmolLM] Thermal throttling active (${currentTier}). Falling back to CPU-only inference.`);
            useVulkan = false;
        }
    }

    const contextId = slot === 'chat' ? 100 : 101; // Different range from legacy contexts

    try {
        const result: SmolLMInitResult = await LlamaCpp.initSmolLM({
            contextId,
            model: config.modelPath,
            params: {
                temperature: config.temperature ?? 0.7,
                min_p: config.minP ?? 0.1,
                n_ctx: config.contextSize ?? 2048,
                n_threads: config.numThreads ?? 6,
                use_mmap: config.useMmap ?? true,
                use_mlock: config.useMlock ?? false,
                use_vulkan: useVulkan,
                store_chats: config.storeChats ?? true,
                chat_template: config.chatTemplate,
                system_prompt: config.systemPrompt,
            }
        });

        if (!result.success) {
            throw new Error('SmolLM initialization failed');
        }

        smolLMContexts.set(slot, {
            contextId,
            modelPath: config.modelPath,
            isLoaded: true
        });

        // Set up token listener if not already done
        if (!tokenListener) {
            tokenListener = await LlamaCpp.addListener('smolLMToken', (event: SmolLMTokenEvent) => {
                const callback = tokenCallbacks.get(event.contextId);
                if (callback) {
                    callback(event.token);
                }
            });
        }

        logger.log('debug', `[SmolLM] ${slot} model initialized with context ID:`, contextId);

    } catch (error: any) {
        logger.log('error', `[SmolLM] Failed to initialize ${slot} model:`, error);
        throw new Error(`SmolLM initialization failed: ${error.message}`);
    }
}

/**
 * Generate text with real token-by-token streaming.
 * Yields tokens as they are generated by the native layer.
 */
export async function* generateSmolLMStream(
    options: SmolLMGenerateOptions,
    slot: SmolLMSlot = 'chat'
): AsyncGenerator<string> {
    const context = smolLMContexts.get(slot);
    if (!context?.isLoaded) {
        throw new Error(`No SmolLM ${slot} model loaded. Call initSmolLM() first.`);
    }

    const requestId = Math.random().toString(36).substring(7);
    logger.log('debug', `[SmolLM] [${requestId}] Starting streaming generation for ${slot}...`);

    // Create a queue for incoming tokens
    const tokenQueue: string[] = [];
    let resolveNextToken: (() => void) | null = null;
    let generationComplete = false;
    let generationError: Error | null = null;

    // Register callback for this context
    tokenCallbacks.set(context.contextId, (token: string) => {
        tokenQueue.push(token);
        if (resolveNextToken) {
            resolveNextToken();
            resolveNextToken = null;
        }
    });

    try {
        // Start streaming completion (this returns when complete)
        const completionPromise = LlamaCpp.streamingCompletion({
            contextId: context.contextId,
            prompt: options.prompt
        }).then((result: SmolLMCompletionResult) => {
            generationComplete = true;
            logger.log('debug', `[SmolLM] [${requestId}] Generation complete:`,
                `${result.tokensPerSecond.toFixed(1)} tok/s, ${result.contextUsed} ctx used`);
            if (resolveNextToken) {
                resolveNextToken();
            }
            return result;
        }).catch((error: Error) => {
            generationError = error;
            generationComplete = true;
            if (resolveNextToken) {
                resolveNextToken();
            }
            throw error;
        });

        // Yield tokens as they arrive
        while (!generationComplete || tokenQueue.length > 0) {
            // Check for abort
            if (options.signal?.aborted) {
                await LlamaCpp.interruptSmolLM({ contextId: context.contextId });
                throw new DOMException('Generation aborted by user', 'AbortError');
            }

            // Wait for next token if queue is empty
            if (tokenQueue.length === 0 && !generationComplete) {
                await new Promise<void>(resolve => {
                    resolveNextToken = resolve;
                });
                continue;
            }

            // Yield all available tokens
            while (tokenQueue.length > 0) {
                const token = tokenQueue.shift()!;
                yield token;

                // Call optional callback
                if (options.onToken) {
                    options.onToken(token);
                }
            }
        }

        // Check for errors after loop
        if (generationError) {
            throw generationError;
        }

        // Wait for completion promise to ensure cleanup
        await completionPromise;

    } finally {
        // Clean up callback
        tokenCallbacks.delete(context.contextId);
        logger.log('debug', `[SmolLM] [${requestId}] Streaming cleanup complete`);
    }
}

/**
 * Generate a complete response (non-streaming).
 */
export async function generateSmolLM(
    options: SmolLMGenerateOptions,
    slot: SmolLMSlot = 'chat'
): Promise<SmolLMResponse> {
    const context = smolLMContexts.get(slot);
    if (!context?.isLoaded) {
        throw new Error(`No SmolLM ${slot} model loaded. Call initSmolLM() first.`);
    }

    logger.log('debug', `[SmolLM] Starting non-streaming generation for ${slot}...`);

    try {
        const result: SmolLMCompletionResult = await LlamaCpp.smolLMCompletion({
            contextId: context.contextId,
            prompt: options.prompt
        });

        logger.log('debug', `[SmolLM] Generation complete:`,
            `${result.tokensPerSecond.toFixed(1)} tok/s, ${result.contextUsed} ctx used`);

        return {
            text: result.text,
            tokensPerSecond: result.tokensPerSecond,
            contextUsed: result.contextUsed,
            interrupted: result.interrupted ?? false
        };

    } catch (error: any) {
        logger.log('error', `[SmolLM] Generation error:`, error);
        throw new Error(`SmolLM generation failed: ${error.message}`);
    }
}

/**
 * Add a message to the chat history.
 */
export async function addSmolLMMessage(
    message: string,
    role: 'system' | 'user' | 'assistant',
    slot: SmolLMSlot = 'chat'
): Promise<void> {
    const context = smolLMContexts.get(slot);
    if (!context?.isLoaded) {
        throw new Error(`No SmolLM ${slot} model loaded.`);
    }

    await LlamaCpp.addSmolLMMessage({
        contextId: context.contextId,
        message,
        role
    });
}

/**
 * Interrupt an ongoing generation.
 */
export async function interruptSmolLM(slot: SmolLMSlot = 'chat'): Promise<void> {
    const context = smolLMContexts.get(slot);
    if (context?.isLoaded) {
        await LlamaCpp.interruptSmolLM({ contextId: context.contextId });
    }
}

/**
 * Get generation metrics.
 */
export async function getSmolLMMetrics(slot: SmolLMSlot = 'chat'): Promise<SmolLMMetrics | null> {
    const context = smolLMContexts.get(slot);
    if (!context?.isLoaded) {
        return null;
    }

    return await LlamaCpp.getSmolLMMetrics({ contextId: context.contextId });
}

/**
 * Release a SmolLM context.
 */
export async function releaseSmolLM(slot: SmolLMSlot = 'chat'): Promise<void> {
    const context = smolLMContexts.get(slot);
    if (!context) {
        return;
    }

    logger.log('debug', `[SmolLM] Releasing ${slot} model...`);

    // Clean up callback
    tokenCallbacks.delete(context.contextId);

    await LlamaCpp.releaseSmolLM({ contextId: context.contextId });
    smolLMContexts.delete(slot);

    logger.log('debug', `[SmolLM] ${slot} model released`);
}

/**
 * Release all SmolLM contexts.
 */
export async function releaseAllSmolLM(): Promise<void> {
    logger.log('debug', '[SmolLM] Releasing all models...');

    // Clean up all callbacks
    tokenCallbacks.clear();

    await LlamaCpp.releaseAllSmolLM();
    smolLMContexts.clear();

    // Remove listener
    if (tokenListener) {
        await tokenListener.remove();
        tokenListener = null;
    }

    logger.log('debug', '[SmolLM] All models released');
}

/**
 * Check if a SmolLM model is loaded in a slot.
 */
export function isSmolLMLoaded(slot: SmolLMSlot = 'chat'): boolean {
    return smolLMContexts.get(slot)?.isLoaded ?? false;
}

/**
 * Get info about a SmolLM slot.
 */
export function getSmolLMInfo(slot: SmolLMSlot = 'chat') {
    const context = smolLMContexts.get(slot);
    return {
        isLoaded: context?.isLoaded ?? false,
        contextId: context?.contextId ?? null,
        modelPath: context?.modelPath ?? null,
    };
}

/**
 * Get all loaded SmolLM slots.
 */
export function getLoadedSmolLMSlots(): SmolLMSlot[] {
    return Array.from(smolLMContexts.entries())
        .filter(([_, ctx]) => ctx.isLoaded)
        .map(([slot, _]) => slot);
}
