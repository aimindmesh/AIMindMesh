import { Message, Personality, LLMConfig, Memory, AIMindMeshServerSettings } from "../../types";
import { logger } from "../logger";
import { generatePerplexityStream } from "./perplexity";
import { generateClaudeStream } from "./claude";

// Import new provider modules
import { generateGeminiStreamWithTools } from "./providers/geminiProvider";
import { generateNativeGGUFStream } from "./providers/ggufProvider";
import { generateLocalStream } from "./providers/localProvider";
import { generateOpenRouterStream } from "./providers/openrouterProvider";
import { generateLiteRTStream } from "./providers/liteRTProvider";
import { callServerProvider } from "./providers/serverProvider";

import { refineContext } from "./context/unifiedContextManager";

export type StreamChunk =
    | { type: 'text'; content: string }
    | { type: 'thinking'; content: string }
    | { type: 'sources'; sources: { title: string; uri: string }[] }
    | { type: 'function_call'; call: { name: string; args: Record<string, unknown> } };

// ------------------------------------------------------------------
// Main Orchestrator Functions
// ------------------------------------------------------------------

/**
 * Main entry point for generating streaming responses from the active LLM provider.
 * Supports thinking chunks, formatting, and provider selection.
 */
import { getRecommendedThreadCount } from "../../utils/hardwareCapabilities";

// ... existing imports ...

export async function* generateTextResponseStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories: Memory[] = [],
    apiKey?: string,
    signal?: AbortSignal,
    maxResponseLength?: number,
    serverSettings?: AIMindMeshServerSettings
): AsyncGenerator<string | StreamChunk> { // Relaxed return type for compatibility
    const provider = llmConfig.provider;

    // Log hardware-optimized configuration suggestion
    const recommendedThreads = getRecommendedThreadCount();
    if (!llmConfig.nThreads) {
        // Only set if not configured at all (legacy fallback to suggested)
        llmConfig.nThreads = recommendedThreads;
    } else if (llmConfig.nThreads !== recommendedThreads) {
        logger.log('info', `[LLMService] Configured threads: ${llmConfig.nThreads}. Hardware recommendation: ${recommendedThreads}`);
    }

    // Prune history to avoid context overflow
    // Estimate 4 chars per token. Reserve 10% for output/overhead.
    // Strategy: Keep latest messages that fit.
    // Use UnifiedContextManager to prune history and system prompt
    const { messages: effectiveHistory, systemPrompt: _prunedSysPrompt } = (() => {
        // Pre-process history to inject file content for ALL providers
        const processedHistory = history.map(msg => {
            if (msg.files && msg.files.length > 0) {
                let fileContext = '\n\n--- Attached Files ---\n';
                msg.files.forEach(file => {
                    fileContext += `File: ${file.name}\nContent:\n${file.content}\n\n`;
                });
                fileContext += '--- End of Attached Files ---\n';
                return { ...msg, text: msg.text + fileContext };
            }
            return msg;
        });

        // For now, we only prune the history here to maintain provider-level system prompt control (LiteRT/GGUF)
        // But we use the unified logic for consistency
        const result = refineContext(processedHistory, "", llmConfig, maxResponseLength || 512);

        if (result.truncated) {
            logger.log('info', `[LLMService] History pruned from ${history.length} to ${result.messages.length} messages.`);
        }

        return { messages: result.messages, systemPrompt: "" };
    })();

    logger.log('info', `[LLM_CHAIN] Generating stream with provider: ${provider}, context window: ${llmConfig.nCtx ?? llmConfig.contextSize ?? 8192}, threads: ${llmConfig.nThreads}`);

    // --- NEW: Hybrid Server-Local Orchestration (v4.0.0) ---
    // If provider is explicitly 'aimindmesh-server', OR (server is enabled AND useAsDefaultProvider is true)
    // We only use serverSideAgenticEnabled if we are already using the server provider or allowed to fallback to it.
    const shouldRouteToServer = provider === 'aimindmesh-server' || (serverSettings?.enabled && serverSettings?.useAsDefaultProvider);

    if (shouldRouteToServer && serverSettings?.enabled) {
        try {
            logger.log('info', `[LLMService] Routing to AIMindMesh Server...`);
            
            const serverHistory = effectiveHistory.map(m => ({ 
                role: (m.role === 'model' ? 'assistant' : m.role) as 'user' | 'assistant' | 'system', 
                content: m.text 
            }));
            
            // Bridge the callback-based server provider to our AsyncGenerator
            const chunkQueue: StreamChunk[] = [];
            let isDone = false;
            let streamError: any = null;

            const serverPromise = callServerProvider({
                settings: serverSettings,
                messages: serverHistory,
                signal,
                options: {
                    thinking: llmConfig.enableThinking,
                    searchEnabled: llmConfig.enableSearch
                },
                onChunk: (chunk: any) => {
                    if (chunk.token) chunkQueue.push({ type: 'text', content: chunk.token });
                    if (chunk.thought) chunkQueue.push({ type: 'thinking', content: chunk.thought });
                    if (chunk.sources) chunkQueue.push({ type: 'sources', sources: chunk.sources });
                    if (chunk.toolCalls) {
                        chunk.toolCalls.forEach((tc: any) => {
                            chunkQueue.push({ type: 'function_call', call: tc });
                        });
                    }
                    if (chunk.done) isDone = true;
                    if (chunk.error) streamError = new Error(chunk.error);
                }
            }).then(fullText => {
                // If we got a full text (REST fallback) and didn't get any chunks yet
                if (fullText && chunkQueue.length === 0) {
                    chunkQueue.push({ type: 'text', content: fullText });
                }
                isDone = true;
            }).catch(err => {
                streamError = err;
                isDone = true;
            });

            // Yield chunks as they arrive in the queue
            while (!isDone || chunkQueue.length > 0) {
                if (streamError) throw streamError;
                if (chunkQueue.length > 0) {
                    const chunk = chunkQueue.shift()!;
                    yield chunk;
                } else {
                    // Small yield point to avoid blocking the thread while waiting for next chunk
                    await new Promise(resolve => setTimeout(resolve, 5));
                    if (signal?.aborted) break;
                }
            }
            
            await serverPromise; // Ensure promise is settled
            return; 
        } catch (e) {
            logger.log('warn', '[LLMService] Server unreachable or failed, falling back to local provider', e);
            // Continue to the switch block below for transparent fallback
        }
    }

    try {
        switch (provider) {
            case 'gemini':
                yield* generateGeminiStreamWithTools(effectiveHistory, personality, llmConfig, memories, apiKey, signal, maxResponseLength);
                break;


            case 'native-gguf':
                // Check if LiteRT engine is selected (hybrid approach)
                if (llmConfig.engine === 'litert' && llmConfig.liteRTModelPath) {
                    for await (const chunk of generateLiteRTStream(effectiveHistory, personality, llmConfig, memories, signal)) {
                        yield chunk;
                    }
                } else {
                    yield* generateNativeGGUFStream(effectiveHistory, personality, llmConfig, memories, signal, maxResponseLength);
                }
                break;

            case 'local':
                for await (const chunk of generateLocalStream(effectiveHistory, personality, llmConfig, memories, signal, maxResponseLength)) {
                    yield { type: 'text', content: chunk };
                }
                break;

            case 'openrouter':
                for await (const chunk of generateOpenRouterStream(effectiveHistory, personality, llmConfig, memories, llmConfig.openrouterApiKey || apiKey, signal, maxResponseLength)) {
                    yield { type: 'text', content: chunk };
                }
                break;

            case 'perplexity':
                // Perplexity now returns StreamChunk directly with tool and thinking support
                yield* generatePerplexityStream(
                    effectiveHistory,
                    personality,
                    llmConfig.perplexityModel || 'sonar-pro',
                    apiKey || '',
                    memories,
                    signal,
                    maxResponseLength,
                    llmConfig
                );
                break;

            case 'claude':
                // Claude now returns StreamChunk directly with tool and thinking support
                yield* generateClaudeStream(
                    effectiveHistory,
                    personality,
                    llmConfig.claudeModel || 'claude-3-5-sonnet-latest',
                    apiKey || '',
                    memories,
                    signal,
                    maxResponseLength,
                    llmConfig
                );
                break;

            case 'litert':
                // LiteRT provider - supports audio and vision modalities
                for await (const chunk of generateLiteRTStream(effectiveHistory, personality, llmConfig, memories, signal)) {
                    yield chunk;
                }
                break;

            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    } catch (error: any) {
        logger.log('error', 'Error in generateTextResponseStream', error);
        throw error;
    }
}

/**
 * Version of the stream generator specifically for Tool Use (Agentic Mode).
 * Currently, only Gemini and Native GGUF fully support tool calling in this refactor.
 * Others strictly return text.
 */
export async function* generateTextResponseStreamWithTools(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories: Memory[] = [],
    apiKey?: string,
    signal?: AbortSignal,
    maxResponseLength?: number,
    serverSettings?: AIMindMeshServerSettings
): AsyncGenerator<StreamChunk> {
    const stream = generateTextResponseStream(history, personality, llmConfig, memories, apiKey, signal, maxResponseLength, serverSettings);

    for await (const chunk of stream) {
        logger.log('debug', `[LLM_CHAIN] generateTextResponseStreamWithTools yielded a chunk`);
        if (typeof chunk === 'string') {
            yield { type: 'text', content: chunk };
        } else {
            // TS narrowing via discriminated union might need help if chunk can be various types
            // But since StreamChunk covers the object cases, and string covers string
            yield chunk as StreamChunk;
        }
    }
}

// ------------------------------------------------------------------
// High-Level Features (Memory, Proactive)
// ------------------------------------------------------------------

/**
 * Generate a summary of the conversation for long-term memory.
 * Uses a faster/cheaper model if possible (e.g., Flash).
 * Accepts either a raw prompt string OR a message history.
 */
export async function generateMemorySummary(
    promptOrHistory: string | Message[],
    llmConfig: LLMConfig,
    apiKey?: string
): Promise<string> {
    logger.log('info', 'Generating memory summary...');

    const summaryHistory: Message[] = Array.isArray(promptOrHistory)
        ? promptOrHistory
        : [{ role: 'user', text: promptOrHistory, id: 'summary-request', timestamp: new Date() }];

    // Force disable tools/thinking for summary efficiency
    // We need a dummy personality if one isn't passed, but the function signature doesn't take personality.
    // Ideally we should update the signature, but for now we'll use a stub since summary shouldn't depend heavily on persona.
    const dummyPersonality: Personality = { name: 'Summarizer', description: 'Summarizer', systemPrompt: 'Summarize', traits: [] };

    const summaryConfig: LLMConfig = {
        ...llmConfig,
        enableToolCalling: false,
        enableThinking: false,
        enableSearch: false,
    };

    // Use specific model for summary if cloud, else fallback to current provider
    if (llmConfig.provider === 'gemini') {
        summaryConfig.geminiModel = 'gemini-2.0-flash-lite'; // Very fast for summaries
    }

    let summary = '';

    try {
        for await (const chunk of generateTextResponseStream(summaryHistory, dummyPersonality, summaryConfig, [], apiKey)) {
            if (typeof chunk === 'string') {
                summary += chunk;
            } else if (chunk.type === 'text' && chunk.content) {
                summary += chunk.content;
            }
        }
        return summary.trim();
    } catch (error) {
        logger.log('error', 'Failed to generate memory summary', error);
        return ""; // Fail gracefully
    }
}

/**
 * Generate a proactive message based on context.
 */
export async function generateProactiveMessage(
    context: string,
    personality: Personality,
    llmConfig: LLMConfig,
    apiKey?: string
): Promise<string> {
    const prompt = `Based on the following context, generate a short, helpful proactive message to the user:\n\n${context}`;

    const history: Message[] = [
        { role: 'user', text: prompt, id: 'proactive', timestamp: new Date() }
    ];

    let message = '';
    try {
        for await (const chunk of generateTextResponseStream(history, personality, llmConfig, [], apiKey)) {
            if (typeof chunk === 'string') {
                message += chunk;
            } else if (chunk.type === 'text' && chunk.content) {
                message += chunk.content;
            }
        }
        return message.trim();
    } catch (error) {
        logger.log('error', 'Failed to generate proactive message', error);
        return "";
    }
}

/**
 * Unload the current LLM to free system resources (RAM/VRAM).
 * Useful when switching to memory-intensive tasks like Voxtral or high-res gaming.
 */
export async function unloadCurrentModel(llmConfig: LLMConfig): Promise<void> {
    logger.log('info', `[LLMService] Unloading current model (Provider: ${llmConfig.provider})...`);

    try {
        // Handle GGUF (Native)
        if (llmConfig.provider === 'native-gguf') {
            // Dynamically import to avoid circular deps if any
            const { unloadNativeModelSlot, getLoadedSlots } = await import('./nativeLLM');
            const slots = getLoadedSlots();
            if (slots.length > 0) {
                logger.log('info', `[LLMService] Unloading GGUF slots: ${slots.join(', ')}`);
                for (const slot of slots) {
                    await unloadNativeModelSlot(slot);
                }
            } else {
                logger.log('debug', '[LLMService] No GGUF models loaded.');
            }
        }

        // Handle LiteRT (Native or Engine)
        if (llmConfig.provider === 'litert' || llmConfig.engine === 'litert') {
            const { releaseLiteRTModel, isLiteRTLoaded } = await import('./providers/liteRTProvider');
            const loaded = await isLiteRTLoaded();
            if (loaded) {
                await releaseLiteRTModel();
                logger.log('info', '[LLMService] LiteRT model released.');
            }
        }

    } catch (error) {
        logger.log('error', '[LLMService] Failed to unload model', error);
        // Don't throw, just log. We tried our best.
    }
}