import { Message, Personality, LLMConfig } from '../../../types';
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
import { toChatRole } from '../roles';
import { detectDeviceContext, onDeviceContextSize } from '../context/contextSize';
import { budgetFor } from '../context/turnBudget';
import { modelFamily } from '../chatFormat/modelFamily';
import { parseToolCalls } from '../chatFormat/toolCallParser';
import { toolStopSequences, visibleText, withoutThought } from '../chatFormat/nativeToolStream';
import { toOpenAIMessages } from '../chatFormat/openAiChat';
import { toTemplateMessages } from './genieSupport';
import { ggufTemplateRendersTools } from './GGUF/ggufToolSupport';
import { routedTools } from '../background/taskFlags';
import { ON_DEVICE_TOOLS, toolDeclarations } from '../../tools/nativeToolDeclarations';

/**
 * Generate stream from Native GGUF model via Capacitor plugin
 */
export async function* generateNativeGGUFStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    signal?: AbortSignal,
    maxResponseLength?: number
): AsyncGenerator<StreamChunk> {

    logger.log('info', '[LLM_CHAIN] Starting generateNativeGGUFStream...');
    // 1. Prepare Context & System Prompt
    logger.log('info', '[LLM_CHAIN] Preparing context and system prompt...');
    // One budget for the trimming and the generation (answer + reasoning, in the real context)
    await detectDeviceContext();
    const budget = budgetFor(llmConfig, personality, maxResponseLength, onDeviceContextSize(llmConfig));
    const slot = (llmConfig as any).useMemorySlot ? 'memory' : 'chat';

    // 2. Initialize Model (if needed): its chat template decides the tool format
    logger.log('info', '[LLM_CHAIN] Initializing native model...');
    await initializeNativeModel(llmConfig);

    // Gemma 4 and Qwen 3 get tools and reasoning in their own format (the template's tool
    // declarations and thinking flag); other models the ReAct prompt and the <thinking> instruction
    const family = modelFamily(llmConfig.nativeModelPath);
    const contextId = nativeLLM.getSlotModelInfo(slot).contextId;
    const hasToolTurns = history.some(m => m.toolMeta);
    const nativeFormat = slot === 'chat' && family !== 'generic' && contextId !== null && (!!llmConfig.enableToolCalling || hasToolTurns)
        && await ggufTemplateRendersTools(contextId, llmConfig.nativeModelPath!);
    const nativeTools = !!llmConfig.enableToolCalling && nativeFormat;
    const nativeThinking = !!llmConfig.enableThinking && family !== 'generic' && (!llmConfig.enableToolCalling || nativeTools);

    // No short-answer rule on turns with tools: it made small models answer instead of calling
    const withTools = !!llmConfig.enableToolCalling || hasToolTurns;
    let { systemPrompt, updatedHistory } = await prepareContext(history, personality, llmConfig, withTools ? undefined : budget.answer, { tools: nativeTools, thinking: nativeThinking });

    // Assign back to history locally so the changes propagate
    history = updatedHistory || history;

    // Workspace documents are in the user turn already (prepareContext)
    const supportsVision = await checkMultimodalCapabilities(history);

    // 3. Process Media Attachments
    logger.log('info', '[LLM_CHAIN] Processing media attachments...');
    const workingHistory = await processAudioAttachments(history);
    const imagesToProcess = supportsVision ? await prepareImagesForProcessing(history) : [];

    // 3. Native context: the full conversation is always sent; the native KV cache reuses the
    // common prefix with the previous prompt (only prompts with images need a reset)
    await syncGGUFContext(slot, { hasImages: imagesToProcess.length > 0 });

    // 4. Truncate History to Fit Context (Smart Refinement)
    logger.log('info', '[LLM_CHAIN] Running smart context refinement...');
    const contextResult = smartContextRefinement(workingHistory, systemPrompt, llmConfig, budget.requested, budget.context);
    const messagesToUse = contextResult.messages;
    const finalSystemPrompt = contextResult.systemPrompt;

    // 5. Format Prompt using Native Template Engine
    logger.log('info', '[LLM_CHAIN] Assembling messages array for native prompt formatter...');
    const messages: { role: string; content: string }[] = nativeFormat
        ? toOpenAIMessages(toTemplateMessages('', messagesToUse, 0, true).slice(1)) // tool turns as tool_calls and tool results
        : messagesToUse.map(msg => ({
            role: toChatRole(msg.role),
            content: msg.text
        }));

    if (finalSystemPrompt) {
        // Replace existing system message if present, otherwise prepend
        if (messages.length > 0 && messages[0].role === 'system') {
            messages[0] = { role: 'system', content: finalSystemPrompt };
        } else {
            messages.unshift({ role: 'system', content: finalSystemPrompt });
        }
    }

    const stopTokens: string[] | undefined = nativeTools ? toolStopSequences(family) : undefined;
    const tools = nativeTools ? JSON.stringify(toolDeclarations(routedTools(llmConfig) ?? ON_DEVICE_TOOLS, llmConfig.toolRules)) : undefined;

    // 6. Generate Stream
    const llmParams = personality.llmParams || {};
    // Same answer budget the context refinement reserved, so prompt + answer fit in nCtx
    const nPredict = budget.maxTokens;
    let fullGeneratedText = '';
    let shownLength = 0;

    const thinkingParser = createThinkingParser();
    const internalController = new AbortController();

    const forwardAbort = () => internalController.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
        logger.log('info', `[LLM_CHAIN] Starting generateNativeStream with ${messages.length} messages`);
        let chunkCount = 0;
        for await (const chunk of nativeLLM.generateNativeStream({
            messages: messages, // Send the native messages array
            temperature: llmParams.temperature ?? 0.7,
            topP: llmParams.topP ?? 0.9,
            maxTokens: nPredict,
            stop: stopTokens,
            signal: internalController.signal,
            images: imagesToProcess,
            tools,
            enableThinking: nativeThinking,
        }, slot)) {
            chunkCount++;
            logger.log('debug', `[LLM_CHAIN] Provider received chunk #${chunkCount}: [${chunk.replace(/\n/g, '\\n')}]`);
            fullGeneratedText += chunk;

            if (nativeTools) {
                // Native calls are parsed at the end, never shown as text
                const visible = visibleText(fullGeneratedText, family);
                if (visible.length > shownLength) {
                    for (const parsedChunk of thinkingParser.processChunk(visible.slice(shownLength))) yield parsedChunk;
                    shownLength = visible.length;
                }
                continue;
            }
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
    } finally {
        signal?.removeEventListener('abort', forwardAbort);
    }

    if (nativeTools) {
        const rest = visibleText(fullGeneratedText, family, true).slice(shownLength);
        if (rest) for (const parsedChunk of thinkingParser.processChunk(rest)) yield parsedChunk;
    }
    for (const parsedChunk of thinkingParser.flush()) {
        yield parsedChunk;
    }

    // 7. Extract Tool Calls
    if (nativeTools) {
        for (const call of parseToolCalls(withoutThought(fullGeneratedText), family).calls) yield { type: 'function_call', call };
    } else if (isToolCallingEnabled(llmConfig)) {
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

