import { Message, Personality, LLMConfig, Memory } from '../../../types';
import { StreamChunk } from '../llmService';
import { logger } from '../../logger';
import { parseReActToolCalls } from '../../tools';
import * as nativeLLM from '../nativeLLM';
import { createThinkingParser } from '../thinkingParser';

import { prepareContext, smartContextRefinement } from './GGUF/contextManager';
import { initializeNativeModel, checkMultimodalCapabilities } from './GGUF/initialization';
import { processAudioAttachments, prepareImagesForProcessing } from './GGUF/mediaHandler';
import { isToolCallingEnabled, hasDedicatedToolModel, extractToolCallsWithDedicatedModel } from './GGUF/toolHandler';
import { syncGGUFContext } from './GGUF/contextSync';

/**
 * Generate stream from Native GGUF model via Capacitor plugin
 */
export async function* generateNativeGGUFStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories?: Memory[],
    signal?: AbortSignal,
    maxResponseLength?: number
): AsyncGenerator<StreamChunk> {

    logger.log('info', '[LLM_CHAIN] Starting generateNativeGGUFStream...');
    // 1. Prepare Context & System Prompt
    logger.log('info', '[LLM_CHAIN] Preparing context and system prompt...');
    let { systemPrompt } = await prepareContext(history, personality, llmConfig, memories, maxResponseLength);

    // Inject Workspace Documents Context
    try {
        const { contextInjector } = await import('../contextInjector');
        systemPrompt = await contextInjector.buildSystemPromptWithContext(history[history.length - 1].text, systemPrompt);
        logger.log('info', '[LLM_CHAIN] Workspace context injected successfully.');
    } catch (e) {
        logger.log('warn', '[LLM_CHAIN] Failed to inject workspace context', e);
    }

    const slot = (llmConfig as any).useMemorySlot ? 'memory' : 'chat';

    // 2. Initialize Model (if needed) & Check Support
    logger.log('info', '[LLM_CHAIN] Initializing native model...');
    await initializeNativeModel(llmConfig);
    const supportsVision = await checkMultimodalCapabilities(history);

    // 3. Process Media Attachments
    logger.log('info', '[LLM_CHAIN] Processing media attachments...');
    const workingHistory = await processAudioAttachments(history);
    const imagesToProcess = supportsVision ? await prepareImagesForProcessing(history) : [];

    // 3. Sync Context State with Native Layer
    logger.log('info', '[LLM_CHAIN] Syncing GGUF context state with native layer...');
    const { messagesToFormat, systemPromptToUse, appendMode } = await syncGGUFContext(
        workingHistory,
        llmConfig,
        systemPrompt,
        slot
    );
    logger.log('info', `[LLM_CHAIN] Sync context complete. appendMode=${appendMode}, messagesToFormat.length=${messagesToFormat.length}`);

    // 4. Truncate History to Fit Context (Smart Refinement)
    let messagesToUse = messagesToFormat;
    let finalSystemPrompt = systemPromptToUse;
    
    if (!appendMode) {
        logger.log('info', '[LLM_CHAIN] Running smart context refinement...');
        const contextResult = smartContextRefinement(messagesToFormat, systemPromptToUse, llmConfig, maxResponseLength);
        messagesToUse = contextResult.messages;
        finalSystemPrompt = contextResult.systemPrompt;
    }

    // 5. Format Prompt using Native Template Engine
    logger.log('info', '[LLM_CHAIN] Assembling messages array for native prompt formatter...');
    const messages = messagesToUse.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text
    }));

    if (!appendMode && finalSystemPrompt) {
        messages.unshift({ role: 'system', content: finalSystemPrompt });
    }

    let stopTokens: string[] | undefined = undefined;

    // 6. Generate Stream
    const llmParams = personality.llmParams || {};
    const nPredict = llmParams.maxTokens ?? (maxResponseLength || 1000);
    let fullGeneratedText = '';

    const thinkingParser = createThinkingParser();
    const internalController = new AbortController();

    if (signal) {
        signal.addEventListener('abort', () => internalController.abort());
    }

    try {
        logger.log('info', `[LLM_CHAIN] Starting generateNativeStream with ${messages.length} messages. appendMode=${appendMode}`);
        let chunkCount = 0;
        for await (const chunk of nativeLLM.generateNativeStream({
            messages: messages, // Send the native messages array
            temperature: llmParams.temperature ?? 0.7,
            topP: llmParams.topP ?? 0.9,
            maxTokens: nPredict,
            stop: stopTokens,
            signal: internalController.signal,
            images: imagesToProcess
        }, slot)) {
            chunkCount++;
            logger.log('debug', `[LLM_CHAIN] Provider received chunk #${chunkCount}: [${chunk.replace(/\n/g, '\\n')}]`);
            fullGeneratedText += chunk;

            if (isToolCallingEnabled(llmConfig)) {
                if (fullGeneratedText.includes('</tool>') || fullGeneratedText.includes('[/tool]')) {
                    logger.log('debug', '[GGUF] 🛑 Tool tag detected, forcing stop to execute tool.');
                    internalController.abort(); 
                    break; 
                }
            }

            for (const parsedChunk of thinkingParser.processChunk(chunk)) {
                yield parsedChunk;
            }
        }
    } catch (error: any) {
        if (internalController.signal.aborted && !signal?.aborted) {
            logger.log('debug', '[GGUF] Generation stopped for tool execution (expected)');
        } else {
            throw error;
        }
    }

    for (const parsedChunk of thinkingParser.flush()) {
        yield parsedChunk;
    }

    // 7. Extract Tool Calls
    if (isToolCallingEnabled(llmConfig)) {
        const { calls: directCalls } = parseReActToolCalls(fullGeneratedText);

        if (directCalls.length > 0) {
            logger.log('info', 'Found tool calls in chat model output', { count: directCalls.length });
            for (const call of directCalls) {
                yield { type: 'function_call', call };
            }
        } else if (hasDedicatedToolModel(llmConfig)) {
            if (!fullGeneratedText || fullGeneratedText.trim().length === 0) {
                logger.log('warn', 'Main model response empty, skipping tool extraction');
                return;
            }

            logger.log('info', 'No direct tool calls found, using dedicated tool-use model', {
                toolModel: llmConfig.toolUseModelPath
            });

            const lastUserMessage = history[history.length - 1].role === 'user'
                ? history[history.length - 1].text
                : 'User request unknown';

            const toolCalls = await extractToolCallsWithDedicatedModel(
                fullGeneratedText,
                lastUserMessage,
                llmConfig,
                history
            );

            for (const call of toolCalls) {
                yield { type: 'function_call', call };
            }
        }
    }
}

