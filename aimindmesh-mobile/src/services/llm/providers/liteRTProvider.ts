/**
 * LiteRT LLM Provider
 * Refactored to use modular sub-modules
 */

import { logger } from '../../logger';
import { Message, Personality, LLMConfig, Memory } from '../../../types';
import { StreamChunk } from '../llmService';
import { buildMessageTextForGGUF } from '../promptFormatters';
import { createThinkingParser } from '../thinkingParser';
import { FileSystemAdapter as Filesystem, Directory } from '../../../utils/fileSystemAdapter';
import { getReActSystemPromptCompact } from '../../toolDefinitions';
import { parseReActToolCalls } from '../../tools';
import { buildSystemPrompt } from '../promptBuilder';

// Modular imports
import { LiteRT, initLiteRTModel, stopLiteRTGeneration, releaseLiteRTSession, restoreLiteRTKvCache, getLiteRTMessageCount } from './liteRT/plugin';
import { syncNativeContext } from './liteRT/context';

// Re-export core functions for external use
export * from './liteRT/types';
export { initLiteRTModel, stopLiteRTGeneration, releaseLiteRTModel, isLiteRTLoaded, generateLiteRTResponse } from './liteRT/plugin';

// Global mutex to prevent concurrent generic LiteRT calls
declare global {
    interface Window {
        __LITERT_MUTEX__?: Promise<void>;
    }
}
if (typeof window !== 'undefined' && !window.__LITERT_MUTEX__) {
    window.__LITERT_MUTEX__ = Promise.resolve();
}

/**
 * Generate a streaming response from LiteRT - Orchestrator compatible version
 */
export async function* generateLiteRTStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    _memories?: Memory[],
    _signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const modelFilename = llmConfig.liteRTModelPath;

    if (!modelFilename) {
        throw new Error('LiteRT model path not configured. Please download a LiteRT model.');
    }

    // Acquire lock
    let releaseLock: () => void = () => { };
    let safeMutex = (typeof window !== 'undefined' && window.__LITERT_MUTEX__)
        ? window.__LITERT_MUTEX__
        : Promise.resolve();

    const previousLock = safeMutex!;
    let currentLockResolve: () => void;
    const currentLock = new Promise<void>((resolve) => {
        currentLockResolve = resolve;
    });

    if (typeof window !== 'undefined') {
        window.__LITERT_MUTEX__ = previousLock.then(() => currentLock);
    }

    try {
        await previousLock;
        releaseLock = currentLockResolve!;
        // Delegate to the inner generator for the actual work
        yield* innerGenerateStream(history, personality, llmConfig, _memories, _signal);
    } catch (error: any) {
        // Only throw if it's not a cancellation
        if (error.name !== 'AbortError') {
            throw error;
        }
    } finally {
        // ALWAYS release the lock, even if the consumer calls .return() early (e.g., React unmount)
        releaseLock();
    }
}

async function* innerGenerateStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    _memories?: Memory[],
    _signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const modelFilename = llmConfig.liteRTModelPath;
    let absoluteModelPath: string;
    try {
        const result = await Filesystem.getUri({ path: modelFilename!, directory: Directory.Data });
        absoluteModelPath = result.uri.replace('file://', '');
    } catch (e) {
        logger.log('error', '[LiteRT] Failed to resolve model path:', e);
        throw new Error(`Model file not found: ${modelFilename}`);
    }

    const activeMemories = [...(_memories || [])];

    if (llmConfig.enableSemanticMemory && llmConfig.embeddingModelId && history.length > 0) {
        try {
            const lastMessage = history[history.length - 1];
            if (lastMessage.role === 'user') {
                const { getOrInitializeSemanticMemoryRetriever } = await import('../../memory/semanticMemoryRetriever');
                const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                if (retriever) {
                    const results = await retriever.retrieveRelevantMemories(lastMessage.text);
                    if (results.length > 0) {
                        const mergedMemory = results.map(r => r.content).join('\n');
                        activeMemories.push({ 
                            id: 'semantic_' + Date.now(),
                            content: `Retrieved Semantic Context related to user query:\n${mergedMemory}`, 
                            category: 'semantic', 
                            timestamp: new Date() 
                        });
                        logger.log('info', `[LiteRT] Injected ${results.length} semantic memories`);
                    }
                }
            }
        } catch (e) {
            logger.log('warn', '[LiteRT] Failed to retrieve semantic memories', e);
        }
    }

    // System Prompt Construction
    let systemPrompt = buildSystemPrompt(personality, activeMemories, undefined, true);
    try {
        const { contextInjector } = await import('../contextInjector');
        systemPrompt = await contextInjector.buildSystemPromptWithContext(history[history.length - 1].text, systemPrompt);
    } catch (e) {
        logger.log('warn', 'Failed to inject workspace context', e);
    }

    // Thinking & Tools injection
    if (llmConfig.enableToolCalling) {
        systemPrompt += "\n" + getReActSystemPromptCompact(llmConfig.toolRules);
    } else if (llmConfig.enableThinking) {
        systemPrompt += `\nIMPORTANT: Before answering, reason step-by-step. Show your thinking process enclosed in <thinking> and </thinking> tags.\nYour final answer goes AFTER the thinking tags.`;
    }

    // Sync context with native layer
    const { messagesToFormat, systemPromptToUse, appendMode } = await syncNativeContext(history, llmConfig, absoluteModelPath, systemPrompt);

    // Always call init to ensure the latest backend config is applied (Java layer handles caching)
    const success = await initLiteRTModel({
        modelPath: absoluteModelPath,
        maxTokens: llmConfig.contextSize || llmConfig.nCtx || 8192,
        temperature: personality.llmParams?.temperature || 0.8,
        topK: 40,
        backend: llmConfig.liteRTBackend || 'CPU',
        useNPU: llmConfig.liteRTUseNPU ?? false,
        enableVision: true,
        storeChats: true,
        enableMtp: llmConfig.liteRTEnableMtp ?? true
    });
    if (!success) throw new Error('Failed to initialize LiteRT model');

    // [KV CACHE] Restore session if current native context is empty and setting is enabled
    const currentCount = await getLiteRTMessageCount();
    if (currentCount === 0 && llmConfig.restoreKvCache) {
        logger.log('info', '[LiteRT] Native session is empty. Attempting KV Cache restoration from disk...');
        await restoreLiteRTKvCache('chat');
    }

    if (!appendMode) {
        try { 
            await stopLiteRTGeneration();
            await releaseLiteRTSession();
            logger.log('debug', '[LiteRT] Session reset for non-append mode (full history provided)');
        } catch (e) { 
            logger.log('warn', '[LiteRT] Pre-generation reset failed', e);
        }
    }

    // Collect multi-modal content
    const allImages: string[] = [];
    const allAudio: string[] = [];
    history.forEach(m => {
        if (m.role === 'user') {
            if (m.images) allImages.push(...m.images.map(img => img.base64 || img.path).filter((img): img is string => !!img));
            if (m.audio) allAudio.push(...m.audio.map(aud => aud.path).filter((aud): aud is string => !!aud));
        }
    });

    let finalPrompt = '';

    if (appendMode && messagesToFormat.length === 1) {
        // Appending a single user message natively: Just send the raw content for wrapping.
        finalPrompt = buildMessageTextForGGUF(messagesToFormat[0], allImages.length > 0, 'gemma');
    } else {
        // Hard Reset: We must pass the full history. 
        // IMPORTANT: LiteRT's Conversation Engine automatically wraps the ENTIRE input in the model's chat template
        // (e.g. `<start_of_turn>user\n{TEXT}<end_of_turn>\n<start_of_turn>model\n`).
        // It DOES NOT parse embedded `<start_of_turn>` tokens as control tokens; it treats them as literal strings.
        // Therefore, we MUST NOT inject our own `<start_of_turn>` tags. We must format the history as a plain-text transcript.
        
        let transcript = systemPromptToUse ? `${systemPromptToUse}\n\n` : '';
        if (messagesToFormat.length > 1) {
            transcript += `--- PAST CONVERSATION ---\n`;
            // Iterate up to the second to last message
            for (let i = 0; i < messagesToFormat.length - 1; i++) {
                const m = messagesToFormat[i];
                const role = m.role === 'user' ? 'User' : personality.name;
                transcript += `${role}: ${buildMessageTextForGGUF(m, allImages.length > 0, 'other')}\n\n`;
            }
            transcript += `--- CURRENT MESSAGE ---\nUser: ${buildMessageTextForGGUF(messagesToFormat[messagesToFormat.length - 1], allImages.length > 0, 'other')}\n${personality.name}:`;
        } else if (messagesToFormat.length === 1) {
            transcript += `${buildMessageTextForGGUF(messagesToFormat[0], allImages.length > 0, 'other')}`;
        }
        finalPrompt = transcript;
    }

    const thinkingParser = createThinkingParser();
    const chunkQueue: { text: string; done: boolean; error?: string; thinkingText?: string }[] = [];
    let resolveQueue: (() => void) | null = null;
    let fullGeneratedText = '';

    try {
        const startStreaming = async () => {
            return LiteRT.generateResponseStream({
                prompt: finalPrompt,
                images: allImages.length > 0 ? allImages : undefined,
                audio: allAudio.length > 0 ? allAudio : undefined,
            }, (result, err) => {
                if (err) {
                    // Ignore cancellation errors that happen during manual stop
                    if (err.message && err.message.toLowerCase().includes('cancelled')) {
                        chunkQueue.push({ text: '', done: true });
                    } else {
                        chunkQueue.push({ text: '', done: true, error: err.message });
                    }
                    if (resolveQueue) { resolveQueue(); resolveQueue = null; }
                    return;
                }
                if (!result) {
                    if (resolveQueue) { resolveQueue(); resolveQueue = null; }
                    return;
                }
                chunkQueue.push({ text: result.text || '', done: result.done || false, error: result.error, thinkingText: result.thinkingText });
                if (resolveQueue) { resolveQueue(); resolveQueue = null; }
            });
        };

        try {
            await startStreaming();
        } catch (initialErr: any) {
            if (initialErr.message && initialErr.message.includes('A session already exists')) {
                logger.log('warn', '[LiteRT] Session conflict detected. Attempting deep reset (release model + re-init)...');
                
                try {
                    await stopLiteRTGeneration();
                    // We don't release session/model here anymore to avoid JNI collisions.
                    // The native plugin's internal retry mechanism will handle the conflict.
                    await new Promise(r => setTimeout(r, 500)); // Cool-off
                    
                    // Re-initialize the model from scratch
                    const success = await initLiteRTModel({
                        modelPath: absoluteModelPath,
                        maxTokens: llmConfig.contextSize || llmConfig.nCtx || 8192,
                        temperature: personality.llmParams?.temperature || 0.8,
                        topK: 40,
                        backend: llmConfig.liteRTBackend || 'CPU',
                        useNPU: llmConfig.liteRTUseNPU ?? false,
                        enableVision: true,
                        storeChats: true,
                        enableMtp: llmConfig.liteRTEnableMtp ?? true
                    });
                    
                    if (!success) throw new Error('Failed to re-initialize LiteRT model after reset');
                    
                    await startStreaming();
                } catch (retryErr: any) {
                    logger.log('error', '[LiteRT] Deep reset failed', retryErr);
                    throw retryErr;
                }
            } else {
                throw initialErr;
            }
        }

        while (true) {
            if (chunkQueue.length > 0) {
                const chunk = chunkQueue.shift()!;
                if (chunk.error) {
                    logger.log('error', '[LiteRT] Streaming chunk error:', chunk.error);
                    throw new Error(chunk.error);
                }

                let content = chunk.text;
                let shouldStop = false;

                // Stop token enforcement for Gemma models
                if (content.includes('<end_of_turn>') || content.includes('<start_of_turn>')) {
                    content = content.replace(/<(?:end_|start_)of_turn>/g, '');
                    shouldStop = true;
                }

                if (chunk.thinkingText) {
                    yield { type: 'thinking', content: chunk.thinkingText };
                }

                if (content) {
                    fullGeneratedText += content;

                    // Removed aggressive client-side stop for tool calls.
                    // If we stop early here, the native LiteRT engine NEVER generates the `<end_of_turn>` token.
                    // This permanently corrupts the native Conversation KV cache for the next tool iteration,
                    // causing hallucinations like `<tool>Answer</tool>`.
                    // We must let the engine naturally emit its `<end_of_turn>` token.

                    for (const parsedChunk of thinkingParser.processChunk(content)) {
                        yield parsedChunk;
                    }
                }

                if (shouldStop) {
                    await stopLiteRTGeneration();
                    chunk.done = true;
                }

                if (chunk.done) break;
            } else {
                if (_signal?.aborted) { await stopLiteRTGeneration(); break; }
                await new Promise<void>((resolve, reject) => {
                    resolveQueue = resolve;
                    if (_signal) _signal.onabort = () => resolve();

                    // Failsafe: if we wait more than 60 seconds for a chunk, abort to release lock
                    setTimeout(() => {
                        if (resolveQueue === resolve) {
                            reject(new Error('LiteRT streaming timeout'));
                        }
                    }, 60000);
                });
            }
        }

        for (const parsedChunk of thinkingParser.flush()) yield parsedChunk;

        if (llmConfig.enableToolCalling) {
            const { calls } = parseReActToolCalls(fullGeneratedText);
            for (const call of calls) yield { type: 'function_call', call };
        }
    } catch (err) {
        logger.log('error', '[LiteRT] Streaming failed:', err);
        try { await stopLiteRTGeneration(); } catch (e) {}
        throw err;
    }
}
