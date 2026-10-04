import { registerPlugin, Capacitor } from '@capacitor/core';
import { logger } from '../logger';
import { StopTokenBuffer } from './nativeStopBuffer';
import { ensureResident, markUnloaded } from '../model/modelOrchestrator';

// TokenData type definition
export type TokenData = {
    token: string;
};

// Register plugin without strict typing since exports are incomplete
const LlamaCpp = registerPlugin('LlamaCpp') as any;



export interface NativeLLMConfig {
    modelPath: string;
    tokenizerPath?: string;   // Optional path to tokenizer.json
    nThreads?: number;        // CPU threads for generation (default: 6 for Z Fold)
    nThreadsBatch?: number;   // CPU threads for batch processing (default: 4)
    nCtx?: number;            // Context size (default: 2048)
    nBatch?: number;          // Batch size for prompt processing (default: 512)
    nUBatch?: number;         // Micro-batch size (default: 512)
    flashAttn?: boolean;      // Enable Flash Attention (default: false)
    cacheTypeK?: string;      // KV cache quantization for keys: 'f16'|'q8_0'|'q4_0' (default: 'f16')
    cacheTypeV?: string;      // KV cache quantization for values (default: 'f16')
    nGpuLayers?: number;      // Number of layers to offload to GPU (default: 0, 99 = all)
    useMmap?: boolean;        // Memory mapping (default: true)
    minP?: number;            // Minimum probability for sampling
    useMlock?: boolean;       // Lock model in memory
    customChatTemplate?: string; // Custom Jinja2 chat template
    multimodalProj?: string;  // Path to the multimodal projector file (mmproj)
    store_chats?: boolean;    // Whether to persist chat history in native layer (default: true)
    useMemorySlot?: boolean;  // If true, use the dedicated 'memory' slot (contextId 2)
    useVulkan?: boolean;      // GPU backend via Vulkan (default: false)
    useOpenCL?: boolean;      // OpenCL backend, optimized for Qualcomm Adreno GPUs (default: false)
    useHexagon?: boolean;     // Hexagon NPU backend (default: false)
}

export interface NativeGenerateOptions {
    prompt?: string;           // Optional legacy prompt
    messages?: any[];          // OpenAI compatible messages array
    images?: string[];         // Array of base64 encoded images
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    stop?: string[];
    signal?: AbortSignal;
    /** Tool declarations (JSON array, OpenAI style) rendered by the model's chat template */
    tools?: string;
    /** The chat template's thinking flag (common_chat defaults it to on) */
    enableThinking?: boolean;
}

// Model slot types
export type ModelSlot = 'chat' | 'tool' | 'memory';

// Context storage for multiple models
interface ModelContext {
    contextId: number;
    modelPath: string;
    multimodalProj?: string;
    nCtx?: number;
}

const modelContexts: Map<ModelSlot, ModelContext> = new Map();

/**
 * Initialize a GGUF model for native inference
 * @param config Model configuration
 * @param slot Which slot to load the model into ('chat' or 'tool'). Default is 'chat'.
 */
// Global initialization lock
let initPromise: Promise<void> | null = null;

export async function initNativeModel(config: NativeLLMConfig, slot: ModelSlot = 'chat'): Promise<void> {
    // If initialization is already in progress, wait for it
    if (initPromise) {
        logger.log('warn', `[NativeLLM] Init already in progress for ${slot}, waiting...`);
        try {
            await initPromise;
            // After waiting, check if we still need to init (maybe it was just done)
            if (modelContexts.has(slot)) {
                const ctx = modelContexts.get(slot);
                if (ctx?.modelPath === config.modelPath) {
                    logger.log('info', `[NativeLLM] Model already initialized after wait:`, config.modelPath);
                    return;
                }
            }
        } catch (e) {
            // Ignore errors from previous init, proceed with new attempt
        }
    }

    // Create a new lock for this initialization
    let resolveInit: () => void;
    let rejectInit: (err: any) => void;
    initPromise = new Promise((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
    });

    try {
        console.log('[NativeLLM-DEBUG] === initNativeModel called for slot:', slot);
        console.log('[NativeLLM-DEBUG] isNativePlatform:', Capacitor.isNativePlatform());
        console.log('[NativeLLM-DEBUG] config.modelPath:', config.modelPath);

        // No other heavy model (Stable Diffusion, another LLM engine, a large STT) stays in RAM
        await ensureResident('gguf');

        // [Native Persistence] Check if model is ALREADY loaded in native layer
        if (Capacitor.isNativePlatform()) {
            console.log('[NativeLLM-DEBUG] Inside native platform check');
            try {
                // Determine context ID based on slot (Chat=0, Tool=1, Memory=2)
                const contextId = slot === 'chat' ? 0 : (slot === 'tool' ? 1 : 2);
                console.log('[NativeLLM-DEBUG] Checking metrics for contextId:', contextId);

                // Get metrics from plugin (requires modified plugin with modelPath)
                // Using 'any' cast because type definition might not be updated yet
                const metrics = await LlamaCpp.getSmolLMMetrics({ contextId });
                console.log('[NativeLLM-DEBUG] Metrics received:', JSON.stringify(metrics));

                const loadedPath = (metrics as any).modelPath;
                console.log('[NativeLLM-DEBUG] Loaded path:', loadedPath, 'matches config:', loadedPath === config.modelPath);

                // Check if loaded model matches desired model
                if (metrics.isLoaded && loadedPath === config.modelPath) {
                    console.log('[NativeLLM-DEBUG] ✅ Model matches! Restoring state...');
                    logger.log('info', `[NativeLLM] 🟢 Model ${slot} already loaded in native layer. Restoring state...`);

                    // Restore state without re-initializing
                    modelContexts.set(slot, {
                        contextId: contextId,
                        modelPath: config.modelPath,
                        multimodalProj: config.multimodalProj,
                        nCtx: config.nCtx,
                    });

                    // CRITICAL FIX: Release the lock before returning!
                    // Without this, all future calls to initNativeModel hang forever.
                    if (resolveInit!) resolveInit();
                    initPromise = null;
                    return;
                } else {
                    console.log('[NativeLLM-DEBUG] ❌ No match. isLoaded:', metrics.isLoaded, 'paths match:', loadedPath === config.modelPath);
                }
            } catch (e: any) {
                // If context not found, this is normal (first load or manually unloaded)
                if (e?.message?.includes('SmolLM context not found')) {
                    console.log('[NativeLLM-DEBUG] Model not loaded in native layer (clean start)');
                } else {
                    console.log('[NativeLLM-DEBUG] ⚠️ Persistence check exception:', e);
                    logger.log('debug', `[NativeLLM] Persistence check failed:`, e);
                }
            }
        } else {
            console.log('[NativeLLM-DEBUG] Not native platform');
        }

        // Check if this slot already has a model loaded
        const existingContext = modelContexts.get(slot);
        if (existingContext) {
            // Unload existing model in this slot
            await unloadNativeModelSlot(slot);
        }

        logger.log('debug', `[NativeLLM] Initializing ${slot} model:`, config.modelPath);
        if (config.multimodalProj) {
            logger.log('debug', `[NativeLLM] Using multimodal projector:`, config.multimodalProj);
        }

        // Detect model family from filename to apply model-specific
        // Auto-detect thread count if not specified or if autoThreads is requested
        let nThreads = config.nThreads ?? 6;
        if (config.nThreads === undefined || config.nThreads === 0) {
            // Auto-detect based on hardware.concurrency
            if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
                // Use ~80% of available cores for inference, min 2, max 8
                nThreads = Math.max(2, Math.floor(navigator.hardwareConcurrency * 0.8));
                logger.log('debug', `[NativeLLM] Auto-detected ${navigator.hardwareConcurrency} cores, using ${nThreads} threads`);
            } else {
                nThreads = 4; // Safe fallback
                logger.log('debug', `[NativeLLM] Could not detect cores, using ${nThreads} threads as fallback`);
            }
        }

        // Initialize context with the model
        // CRITICAL FIX: Use simple integers (0 and 1) for context IDs. 
        // Using Date.now() causes Integer Overflow in Java/C++ layer, mapping different IDs to 0.
        const contextId = slot === 'chat' ? 0 : (slot === 'tool' ? 1 : 2); // Same mapping as the persistence check above

        try {
            const { isDesktop } = await import('../../utils/platform');

            if (isDesktop()) {
                const { invoke } = await import('@tauri-apps/api/core');
                logger.log('info', `[NativeLLM] Initializing GGUF model on Desktop...`, config.modelPath);

                try {
                    await invoke('llm_init_model_candle', {
                        modelPath: config.modelPath,
                        tokenizerPath: config.tokenizerPath || config.modelPath.replace(/\.gguf$/, '.tokenizer.json'),
                    });
                    logger.log('info', `[NativeLLM] Desktop GGUF model initialized successfully`);
                } catch (err: any) {
                    const errorMsg = `[NativeLLM] Desktop invoke failed: ${err?.message || err}`;
                    logger.log('error', errorMsg, err);
                    // Also log to console for visibility in dev tools
                    console.error(errorMsg, err);
                    throw new Error(errorMsg);
                }
            } else {
                // Use initSmolLM for streaming support
                await LlamaCpp.initSmolLM({
                    contextId: contextId,
                    modelPath: config.modelPath,
                    multimodalProj: config.multimodalProj ?? "",
                    params: {
                        min_p: config.minP ?? 0.05,
                        temperature: 0.8,
                        store_chats: config.store_chats ?? true,
                        n_ctx: config.useOpenCL ? Math.min(config.nCtx ?? 2048, 8192) : (config.nCtx ?? 2048),
                        chat_template: config.customChatTemplate ?? "",
                        n_threads: nThreads,
                        use_mmap: config.useMmap ?? true,
                        use_mlock: config.useMlock ?? false,
                        use_opencl: config.useOpenCL ?? false,
                        use_vulkan: (config.useOpenCL ? false : (config.useVulkan ?? false)),
                        use_hexagon: config.useHexagon ?? false,
                        // New context params matching PocketPal getEffectiveContextInitParams
                        n_batch: Math.max(512, config.nBatch ?? 512),
                        n_ubatch: Math.max(256, config.nUBatch ?? 256),
                        flash_attn: config.flashAttn ?? (Capacitor.getPlatform() === 'ios'),
                        cache_type_k: config.cacheTypeK ?? 'f16',
                        cache_type_v: config.cacheTypeV ?? 'f16',
                        n_gpu_layers: config.nGpuLayers ?? 99,
                    }
                });
            }
        } catch (e: any) {
            logger.log('error', `[NativeLLM] Failed to initialize model:`, e);
            throw e;
        }

        // [KV CACHE] Restore session if slot is empty (only for native platforms)
        if (Capacitor.isNativePlatform()) {
            try {
                const metrics = await LlamaCpp.getSmolLMMetrics({ contextId });
                if (metrics.messageCount === 0) {
                    logger.log('info', `[NativeLLM] Slot ${slot} (${contextId}) is empty. Attempting KV Cache restoration...`);
                    await restoreNativeKvCache(slot);
                }
            } catch (e) {
                // Ignore restoration errors, proceed with fresh context
                logger.log('debug', `[NativeLLM] KV Cache restoration skipped or failed for ${slot}:`, e);
            }
        }

        // Store in the appropriate slot
        modelContexts.set(slot, {
            contextId: contextId,
            modelPath: config.modelPath,
            multimodalProj: config.multimodalProj,
            nCtx: config.nCtx,
        });

        logger.log('debug', `[NativeLLM] ${slot} model initialized with context ID:`, contextId);

        // Resolve the lock
        if (resolveInit!) resolveInit();
        initPromise = null;
    } catch (e: any) {
        logger.log('error', `[NativeLLM] Failed to initialize model:`, e);
        // Reject the lock
        if (rejectInit!) rejectInit(e);
        initPromise = null;
        throw e;
    }
}

// Define global type for per-slot mutexes
declare global {
    interface Window {
        __NATIVE_SLOT_MUTEXES__?: Record<string, Promise<void>>;
        __NATIVE_LLM_MODULE_ID__?: string;
    }
}

// Generate random module ID to detect duplication
const MODULE_ID = Math.random().toString(36).substring(7);
logger.log('debug', `[NativeLLM] Module loaded. ID: ${MODULE_ID}`);

if (typeof window !== 'undefined') {
    if (window.__NATIVE_LLM_MODULE_ID__) {
        logger.log('warn', `[NativeLLM] WARNING: Module loaded MULTIPLE TIMES! First ID: ${window.__NATIVE_LLM_MODULE_ID__}, Current ID: ${MODULE_ID}`);
    } else {
        window.__NATIVE_LLM_MODULE_ID__ = MODULE_ID;
    }
}

// Per-slot mutexes to allow concurrent generation across different slots
// Each slot (chat, tool, memory) gets its own promise chain.
// Attach to window to ensure singleton across module instances.
if (typeof window !== 'undefined' && !window.__NATIVE_SLOT_MUTEXES__) {
    window.__NATIVE_SLOT_MUTEXES__ = {};
}

function getSlotMutex(slot: ModelSlot): Promise<void> {
    if (typeof window !== 'undefined' && window.__NATIVE_SLOT_MUTEXES__) {
        if (!window.__NATIVE_SLOT_MUTEXES__[slot]) {
            window.__NATIVE_SLOT_MUTEXES__[slot] = Promise.resolve();
        }
        return window.__NATIVE_SLOT_MUTEXES__[slot];
    }
    return Promise.resolve();
}

function setSlotMutex(slot: ModelSlot, mutex: Promise<void>): void {
    if (typeof window !== 'undefined' && window.__NATIVE_SLOT_MUTEXES__) {
        window.__NATIVE_SLOT_MUTEXES__[slot] = mutex;
    }
}

/**
 * Generate text stream from a model
 * @param options Generation options
 * @param slot Which model slot to use. Default is 'chat'.
 */
export async function* generateNativeStream(
    options: NativeGenerateOptions,
    slot: ModelSlot = 'chat'
): AsyncGenerator<string> {
    const context = modelContexts.get(slot);

    if (!context) {
        throw new Error(`No ${slot} model loaded. Call initNativeModel() first.`);
    }

    const requestId = Math.random().toString(36).substring(7);
    logger.log('debug', `[NativeLLM] [Req:${requestId}] Requesting lock for ${slot} generation... (Module: ${MODULE_ID})`);

    // Acquire per-slot lock
    let releaseLock: () => void = () => { };

    const slotMutex = getSlotMutex(slot);

    const previousLock = slotMutex;
    let currentLockResolve: () => void;

    const currentLock = new Promise<void>((resolve) => {
        currentLockResolve = resolve;
    });

    setSlotMutex(slot, previousLock.then(() => currentLock));

    // Native generation still running: waited for (after an interrupt) before the slot is released,
    // since the native context rejects a new completion while one is in progress
    let nativeSettled = true;
    let nativeDone: Promise<unknown> = Promise.resolve();
    let desktop = false;

    try {
        await previousLock;
        releaseLock = currentLockResolve!;
        logger.log('debug', `[NativeLLM] [Req:${requestId}] Lock acquired for ${slot}. Starting generation...`);

        if (options.signal?.aborted) {
            throw new DOMException('Generation aborted by user', 'AbortError');
        }

        // Shared state for the generator loop
        const tokenQueue: string[] = [];
        let generationError: any = null;
        let isComplete = false;
        const stopBuffer = new StopTokenBuffer(options.stop);

        const { isDesktop } = await import('../../utils/platform');
        desktop = isDesktop();
        let unlistenDesktop: (() => void) | undefined;

        // Native Chat Formatting
        let finalPrompt = options.prompt || "";
        if (options.messages && options.messages.length > 0 && !desktop) {
            try {
                logger.log('debug', `[NativeLLM] [Req:${requestId}] Formatting chat messages natively...`);
                // Use getFormattedChat from Capacitor plugin to apply GGUF template directly in C++
                const formatResult = await LlamaCpp.getFormattedChat({
                    contextId: context.contextId,
                    messages: JSON.stringify(options.messages),
                    chatTemplate: "", // Empty uses model's default
                    tools: options.tools ?? '',
                    enableThinking: !!options.enableThinking,
                });
                if (formatResult && formatResult.prompt) {
                    finalPrompt = formatResult.prompt;
                    logger.log('debug', `[NativeLLM] [Req:${requestId}] Native formatting successful.`);
                }
            } catch (fmtError) {
                logger.log('warn', `[NativeLLM] [Req:${requestId}] Native chat formatting failed, using manual fallback`, fmtError);
            }

            // Bug #8 Fix: If getFormattedChat failed or returned empty, build a plain-text
            // fallback prompt manually. This prevents an exception that would silently produce
            // an empty stream (and trigger the "I apologize" hardcoded fallback in useAgenticLoop).
            if (!finalPrompt && options.messages.length > 0) {
                logger.log('warn', `[NativeLLM] [Req:${requestId}] Building manual fallback prompt from messages array.`);
                finalPrompt = options.messages.map((m: any) => {
                    const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
                    return `${role}: ${m.content}`;
                }).join('\n\n') + '\n\nAssistant:';
            }
        }

        if (!finalPrompt && !desktop) {
            throw new Error("No prompt or messages provided for generation.");
        }

        if (desktop) {
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');

            // Desktop generation logic
            unlistenDesktop = await listen<string>('llm_token', (event) => {
                if (event.payload) {
                    tokenQueue.push(event.payload);
                }
            });

            invoke('llm_generate_candle', {
                prompt: finalPrompt || options.prompt, // Desktop might still need raw prompt if messages not supported
                maxTokens: options.maxTokens ?? 1000,
                temperature: options.temperature ?? 0.8,
            }).then(() => {
                isComplete = true;
            }).catch((err) => {
                generationError = err;
                isComplete = true;
            });

        } else {
            // Add listener
            logger.log('debug', `[LLM_CHAIN] [Req:${requestId}] Registering smolLMToken listener for contextId=${context.contextId}`);
            const listener = await LlamaCpp.addListener('smolLMToken', (data: any) => {
                // Use Number() coercion: Capacitor may serialize the Java int as a JS string
                if (Number(data.contextId) === context.contextId) {
                    if (data.token) {
                        logger.log('debug', `[LLM_CHAIN] [Req:${requestId}] Token received from bridge: [${data.token.replace(/\n/g, '\\n')}]`);
                        tokenQueue.push(data.token);
                    }
                }
            });

            // Start streaming completion. Limits and sampling are optional native params:
            // absent ones keep the native defaults (no token limit, load-time sampling)
            logger.log('info', `[LLM_CHAIN] [Req:${requestId}] Calling streamingCompletion for contextId=${context.contextId}, promptLen=${finalPrompt.length}`);
            nativeSettled = false;
            nativeDone = LlamaCpp.streamingCompletion({
                contextId: context.contextId,
                prompt: finalPrompt,
                images: options.images, // Pass images to native layer if present
                nPredict: options.maxTokens,
                temperature: options.temperature,
                topP: options.topP,
                stop: options.stop,
            }).then(() => {
                logger.log('debug', `[NativeLLM] [Req:${requestId}] ${slot} generation complete.`);
                isComplete = true;
            }).catch((err: any) => {
                logger.log('error', `[NativeLLM] [Req:${requestId}] ${slot} generation error:`, err);
                generationError = err;
                isComplete = true;
            }).finally(() => {
                nativeSettled = true;
                listener.remove();
            });
        }

        // Yield tokens loop
        logger.log('debug', `[LLM_CHAIN] [Req:${requestId}] Starting token yield loop...`);
        while (!isComplete || tokenQueue.length > 0) {
            if (options.signal?.aborted) {
                // TODO: Implement cancel for desktop; native generation is interrupted in finally
                throw new DOMException('Generation aborted by user', 'AbortError');
            }

            if (generationError) throw generationError;

            const token = tokenQueue.shift();
            if (token === undefined) {
                // Wait a bit to avoid busy loop
                await new Promise(r => setTimeout(r, 10));
                continue;
            }

            const { text, stopped } = stopBuffer.push(token);
            if (text) yield text;
            if (stopped) {
                logger.log('info', `[LLM_CHAIN] [Req:${requestId}] Manual stop token detected`);
                isComplete = true;
                break;
            }
        }

        // Yield any remaining safe buffer at the end
        const rest = stopBuffer.flush();
        if (rest) yield rest;

        logger.log('debug', `[LLM_CHAIN] [Req:${requestId}] Token yield loop finished. isComplete=${isComplete}, queueLen=${tokenQueue.length}`);

        if (unlistenDesktop) {
            unlistenDesktop();
        }

    } catch (error: any) {
        if (error.name === 'AbortError') {
            logger.log('debug', `[NativeLLM] [Req:${requestId}] ${slot} generation aborted`);
            throw error;
        }
        logger.log('error', `[NativeLLM] [Req:${requestId}] ${slot} generation error:`, error);
        throw new Error(`Native LLM generation failed: ${error.message}`);
    } finally {
        // Reached on abort, on a stop marker and when the caller stops reading early (tool call):
        // the native loop only ends on end-of-generation or interrupt
        if (!nativeSettled && !desktop) {
            await LlamaCpp.interruptSmolLM({ contextId: context.contextId }).catch(() => {});
            await Promise.race([nativeDone, new Promise(r => setTimeout(r, 5000))]);
        }
        logger.log('debug', `[NativeLLM] [Req:${requestId}] Releasing lock for ${slot}`);
        releaseLock();
    }
}

/**
 * Unload a model from a specific slot
 */
export async function unloadNativeModelSlot(slot: ModelSlot): Promise<void> {
    const context = modelContexts.get(slot);
    if (!context) {
        return;
    }

    logger.log('debug', `[NativeLLM] Unloading ${slot} model...`);

    const { isDesktop } = await import('../../utils/platform');
    if (isDesktop()) {
        // TODO: Implement unload for candle if needed, 
        // currently it just overwrites the state on next init
        // const { invoke } = await import('@tauri-apps/api/core');
        // await invoke('llm_unload'); 
        logger.log('warn', '[NativeLLM] Unload not implemented for Candle yet');
    } else {
        await LlamaCpp.releaseSmolLM({
            contextId: context.contextId
        });
    }

    modelContexts.delete(slot);
    if (modelContexts.size === 0) markUnloaded('gguf');

    logger.log('debug', `[NativeLLM] ${slot} model unloaded`);
}

/**
 * Force release all potential context slots (0-4) directly to native layer
 * bypassing the internal map tracking. This is a safety measure for OOM prevention.
 */
export async function forceReleaseAllContexts(): Promise<void> {
    logger.log('warn', '[NativeLLM] Force releasing all contexts (0-4)...');
    for (let i = 0; i < 5; i++) {
        try {
            await LlamaCpp.releaseSmolLM({ contextId: i });
        } catch (e) {
            // Ignore errors if context didn't exist
        }
    }
    modelContexts.clear();
    markUnloaded('gguf');
    logger.log('warn', '[NativeLLM] All contexts force released');
}

/**
 * Unload the current model and free resources (legacy - unloads chat model)
 */
export async function unloadNativeModel(): Promise<void> {
    await unloadNativeModelSlot('chat');
}

/**
 * Reset the context (history and KV cache) for a specific slot.
 * This is faster than unloading and reloading the model.
 */
export async function resetNativeContext(slot: ModelSlot = 'chat'): Promise<void> {
    const context = modelContexts.get(slot);
    if (!context) {
        return; // Nothing to reset
    }

    const { isDesktop } = await import('../../utils/platform');
    if (isDesktop()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('llm_reset_context');
    } else {
        await LlamaCpp.resetSmolLMContext({
            contextId: context.contextId
        });
    }
    logger.log('info', `[NativeLLM] ${slot} context reset`);
}

/**
 * Get info about a specific model slot
 */
export function getSlotModelInfo(slot: ModelSlot) {
    const context = modelContexts.get(slot);
    return {
        isLoaded: !!context,
        contextId: context?.contextId ?? null,
        modelPath: context?.modelPath ?? null,
        multimodalProj: context?.multimodalProj ?? null,
        nCtx: context?.nCtx,
    };
}

/**
 * Get info about the currently loaded chat model (legacy compatibility)
 */
export function getCurrentModelInfo() {
    return getSlotModelInfo('chat');
}

/**
 * Get the number of messages in the native history for a specific slot.
 */
export async function getNativeMessageCount(slot: ModelSlot = 'chat'): Promise<number> {
    const context = modelContexts.get(slot);
    if (!context) {
        return 0;
    }

    try {
        const { isDesktop } = await import('../../utils/platform');
        if (isDesktop()) {
            return 0; // TODO: Implement for desktop
        } else {
            const metrics = await LlamaCpp.getSmolLMMetrics({
                contextId: context.contextId
            });
            return metrics.messageCount ?? 0;
        }
    } catch (e) {
        logger.log('warn', `[NativeLLM] Failed to get message count for ${slot}`, e);
        return 0;
    }
}

/**
 * Check if both chat and tool models are loaded
 */
export function areDualModelsLoaded(): boolean {
    return modelContexts.has('chat') && modelContexts.has('tool');
}

/**
 * Get all loaded model slots
 */
export function getLoadedSlots(): ModelSlot[] {
    return Array.from(modelContexts.keys());
}

/**
 * Get available models from device storage
 */
export async function getAvailableNativeModels(): Promise<Array<{ name: string; path: string; size: number }>> {
    return LlamaCpp.getAvailableModels();
}

/**
 * Save KV cache state for a specific slot using native in-process state serialization.
 * Uses llama_state_seq_save_file via JNI — no external server required.
 */
export async function saveNativeKvCache(slot: ModelSlot = 'chat'): Promise<boolean> {
    const context = modelContexts.get(slot);
    if (!context) return false;

    try {
        const result = await LlamaCpp.saveKvCache({
            contextId: context.contextId,
            slot: slot
        });
        return result.success;
    } catch (e) {
        logger.log('error', `[NativeLLM] Failed to save KV Cache for ${slot}:`, e);
        return false;
    }
}

/**
 * Restore KV cache state for a specific slot using native in-process state deserialization.
 * Uses llama_state_seq_load_file via JNI — no external server required.
 */
export async function restoreNativeKvCache(slot: ModelSlot = 'chat'): Promise<boolean> {
    const context = modelContexts.get(slot);
    if (!context) return false;

    try {
        const result = await LlamaCpp.restoreKvCache({
            contextId: context.contextId,
            slot: slot
        });
        return result.success;
    } catch (e) {
        logger.log('error', `[NativeLLM] Failed to restore KV Cache for ${slot}:`, e);
        return false;
    }
}

/**
 * Invalidate KV cache state for a specific slot by deleting the persisted state file.
 */
export async function invalidateNativeKvCache(slot: ModelSlot = 'chat'): Promise<boolean> {
    const context = modelContexts.get(slot);
    if (!context) return false;

    try {
        const result = await LlamaCpp.invalidateKvCache({
            contextId: context.contextId,
            slot: slot
        });
        return result.success;
    } catch (e) {
        logger.log('error', `[NativeLLM] Failed to invalidate KV Cache for ${slot}:`, e);
        return false;
    }
}
