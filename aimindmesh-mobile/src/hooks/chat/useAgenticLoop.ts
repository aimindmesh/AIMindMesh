import { useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Message, Personality, LLMConfig, SpeechConfig, ResponseStyle, AIMindMeshServerSettings, ImageAttachment } from '../../types';
import { ChatContext, ApiKeys, AgentContext, ToolCall, ToolRunResult } from './types';
import { logger } from '../../services/logger';
import { triggerHaptic } from '../../services/native';
import { speak } from '../../services/tts/speech';
import { generateTextResponseStreamWithTools, generateMemorySummary } from '../../services/llm/llmService';
import { getMaxTokensForStyle, processCompletedResponse } from '../../services/llm/responseUtils';
import { executeTool, needsConfirmation, isToolDenied } from '../../services/tools';
import { useContextCompression } from './useContextCompression';
import { estimateTokens } from '../../services/llm/context/unifiedContextManager';
import { applyContextSummary } from '../../services/llm/contextSummaryStore';
import { getActiveThreadId } from '../../services/llm/threadManager';
import { imageFromToolData, resolveToolSourceImage } from '../../services/image/imagePrompt';
import {
    effectiveProvider, apiKeyForProvider, compressionBudget, streamDisplayText, buildToolTurnText,
    buildObservationMessage, mergeTextThinking, extractInlineMemories, cleanFinalAnswer, shouldNudgeModel
} from './agentLoopHelpers';

interface UseAgenticLoopProps {
    llmConfig: LLMConfig;
    personality: Personality;
    speechConfig: SpeechConfig;
    apiKeys: ApiKeys;
    responseStyle: ResponseStyle;
    autoPlayAudio: boolean;
    context: ChatContext;
    activeThreadId: string | null;
    onUpdateToolRules?: (toolName: string, rule: 'allow' | 'confirm' | 'deny') => void;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setIsLoading: (loading: boolean) => void;
    setIsSpeaking: (speaking: boolean) => void;
    serverSettings?: AIMindMeshServerSettings;
}

const toolLabel = (name: string) => name.split(' ')[0].split('(')[0].trim();

export const useAgenticLoop = ({
    llmConfig,
    personality,
    speechConfig,
    apiKeys,
    responseStyle,
    autoPlayAudio,
    context,
    activeThreadId,
    onUpdateToolRules,
    setMessages,
    setIsLoading,
    setIsSpeaking,
    serverSettings
}: UseAgenticLoopProps) => {
    const [pendingToolCall, setPendingToolCall] = useState<ToolCall | null>(null);
    // Controller of the run that is generating (null when idle or paused on a confirmation)
    const abortControllerRef = useRef<AbortController | null>(null);
    const pausedAgentContextRef = useRef<AgentContext | null>(null);

    const { compressHistoryIfNeeded } = useContextCompression();

    const allowSleep = useCallback(() => {
        if (llmConfig.keepScreenOn && Capacitor.isNativePlatform()) {
            KeepAwake.allowSleep().catch(() => { });
        }
    }, [llmConfig.keepScreenOn]);

    /** A run is generating or waiting for a tool confirmation: new requests are refused meanwhile */
    const isBusy = useCallback(() => abortControllerRef.current !== null || pausedAgentContextRef.current !== null, []);

    const stopGeneration = useCallback(() => {
        const paused = pausedAgentContextRef.current;
        if (!abortControllerRef.current && !paused) return;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        // A run waiting for a confirmation is cancelled too: drop the dialog and its status line
        if (paused) {
            pausedAgentContextRef.current = null;
            setPendingToolCall(null);
            setMessages(prev => prev.map(msg => msg.id === paused.modelMessageId
                ? { ...msg, text: streamDisplayText(paused.accumulatedResponse) } : msg));
        }
        setIsLoading(false);
        allowSleep();
        triggerHaptic('MEDIUM');
    }, [setIsLoading, setMessages, allowSleep]);

    /**
     * Core Agentic Loop: generate, run the requested tools (pausing on those that need a
     * confirmation), feed their results back, until the model answers or the step limit.
     */
    const runAgenticLoop = useCallback(async (
        initialHistory: Message[],
        resumeContext?: AgentContext,
        decision?: { allowed: boolean }
    ) => {
        // One run at a time: a second one would share the bubble, the abort and the loading state
        if (abortControllerRef.current || (!resumeContext && pausedAgentContextRef.current)) {
            logger.log('warn', '[AgenticLoop] A generation is already in progress, request ignored');
            return;
        }
        logger.log('info', `[LLM_CHAIN] runAgenticLoop initiated${resumeContext ? ' (resumed after confirmation)' : ''}`);

        const controller = new AbortController();
        const signal = controller.signal;
        abortControllerRef.current = controller;
        const isActiveRun = () => abortControllerRef.current === controller;
        let paused = false;
        setIsLoading(true);

        if (llmConfig.keepScreenOn && Capacitor.isNativePlatform()) {
            try { KeepAwake.keepAwake(); } catch (e) { }
        }

        // The model gets the thread's context summary in place of the messages it covers (the chat keeps them)
        let conversationHistory = resumeContext ? [...resumeContext.conversationHistory] : applyContextSummary([...initialHistory], activeThreadId ?? getActiveThreadId());
        const modelMessageId = resumeContext ? resumeContext.modelMessageId : (Date.now() + 1).toString();
        const maxIterations = llmConfig.maxAgentIterations || 5;
        let currentIteration = resumeContext ? resumeContext.currentIteration : 0;

        let accumulatedResponse = resumeContext ? resumeContext.accumulatedResponse : '';
        let accumulatedThinking = resumeContext ? resumeContext.accumulatedThinking : '';
        let accumulatedSources = resumeContext ? [...resumeContext.accumulatedSources] : [];
        const accumulatedToolResults: ToolRunResult[] = resumeContext ? [...resumeContext.accumulatedToolResults] : [];
        const generatedImages: ImageAttachment[] = resumeContext ? [...(resumeContext.generatedImages || [])] : [];

        // Tool batch in progress: calls still to run, their results so far, the turn that asked for them
        let pendingBatch: ToolCall[] = resumeContext ? [...resumeContext.pendingToolCalls] : [];
        let batchResults: ToolRunResult[] = resumeContext ? [...(resumeContext.batchResults || [])] : [];
        let batchModelText = resumeContext?.batchModelText ?? '';
        let pendingDecision = pendingBatch.length > 0 ? decision : undefined; // Applies to the call that paused

        if (!resumeContext) {
            const modelMessage: Message = { id: modelMessageId, role: 'model', text: '', timestamp: new Date() };
            setMessages(_prev => [...initialHistory, modelMessage]);
        }

        let lastUpdateTimestamp = 0;
        const throttledUpdate = (status?: string) => {
            if (signal.aborted) return; // A stopped run no longer writes into the bubble
            const now = Date.now();
            if (!status && now - lastUpdateTimestamp < 100) return;
            lastUpdateTimestamp = now;

            const displayText = streamDisplayText(accumulatedResponse, status);
            const thinking = accumulatedThinking.replace(/^\s+/, '') || undefined;
            const sources = accumulatedSources.length > 0 ? accumulatedSources : undefined;
            const toolResults = accumulatedToolResults.length > 0 ? [...accumulatedToolResults] : undefined;
            const images = generatedImages.length > 0 ? [...generatedImages] : undefined;
            logger.log('debug', `[LLM_CHAIN] UI UPDATE (throttled): Text length=${displayText.length}, updating React state.`);
            setMessages(prev => prev.map(msg =>
                msg.id === modelMessageId ? { ...msg, text: displayText, thinking, sources, toolResults, images } : msg
            ));
        };

        const record = (result: ToolRunResult) => {
            accumulatedToolResults.push(result);
            batchResults.push(result);
        };

        try {
            const toolContext = {
                todos: context.todos,
                memories: context.memories,
                addTodo: context.addTodo,
                completeTodo: context.completeTodo,
                addMemory: context.addMemory,
                confirmationMode: llmConfig.toolConfirmationMode || 'dangerous',
                llmConfig: llmConfig
            };

            const provider = effectiveProvider(llmConfig, serverSettings);
            const effectiveApiKey = apiKeyForProvider(provider, apiKeys, llmConfig);
            const maxResponseTokens = getMaxTokensForStyle(responseStyle);
            const historyBudget = compressionBudget(provider, llmConfig, maxResponseTokens);

            const runTool = async (call: ToolCall): Promise<ToolRunResult> => {
                logger.log('debug', '[AgenticLoop] Executing tool:', call.name);
                throttledUpdate(`🔧 Executing: ${toolLabel(call.name)}...`);
                try {
                    if (call.name === 'generate_image' && call.args?.source_image) {
                        // The model names the image to edit ("last"); the pixels come from the chat
                        const { source, error } = resolveToolSourceImage(call.args.source_image, conversationHistory, generatedImages);
                        if (error) return { name: call.name, success: false, result: error };
                        call = { ...call, args: { ...call.args, source_image: source } };
                    }
                    const result = await executeTool(call, toolContext);
                    const image = imageFromToolData(result.data);
                    if (image) generatedImages.push(image); // shown in the bubble, never sent back to the model
                    let cleanResult = result.message.split('\n\n').filter((b: string) => !b.trim().startsWith('[SYSTEM')).join('\n\n').trim();

                    // Tool Output Pruning: Summarize long tool outputs
                    if (estimateTokens(cleanResult) > 800 && !signal.aborted) {
                        throttledUpdate(`✂️ Summarizing large result from ${toolLabel(call.name)}...`);
                        try {
                            const summary = await generateMemorySummary(`Summarize this tool output keeping only facts relevant to answer a user request. Output: ${cleanResult.substring(0, 15000)}`, llmConfig, effectiveApiKey);
                            if (summary) {
                                cleanResult = `[Summarized by system due to length]\n${summary}`;
                            }
                        } catch (e) {
                            logger.log('warn', '[AgenticLoop] Failed to summarize tool output, truncating instead');
                        }
                    }

                    // Always ensure we don't exceed a hard limit to prevent crash
                    cleanResult = cleanResult.substring(0, 4000);
                    context.showToast(result.message.substring(0, 80) + (result.message.length > 80 ? '...' : ''), result.success ? 'success' : 'error');
                    return { name: call.name, success: result.success, result: cleanResult };
                } catch (error) {
                    return { name: call.name, success: false, result: (error as Error).message };
                }
            };

            while (currentIteration < maxIterations) {
                if (signal.aborted) return;

                if (pendingBatch.length === 0) {
                    if (currentIteration > 0) {
                        throttledUpdate(`🔄 Reasoning step ${currentIteration} of ${maxIterations}...`);
                    }

                    // On-device models have a small window (Gemma 3n ~4k); remote ones prune by themselves
                    if (Number.isFinite(historyBudget)) {
                        conversationHistory = compressHistoryIfNeeded(conversationHistory, historyBudget);
                    }

                    const stream = await generateTextResponseStreamWithTools(
                        conversationHistory,
                        personality,
                        llmConfig,
                        context.memories,
                        effectiveApiKey,
                        signal,
                        maxResponseTokens,
                        serverSettings
                    );

                    accumulatedResponse = ''; // Each step has its own answer text
                    let iterationResponse = '';
                    const requestedCalls: ToolCall[] = [];

                    for await (const chunk of stream) {
                        if (signal.aborted) break;
                        if (chunk.type === 'text') {
                            iterationResponse += chunk.content;
                            if (!iterationResponse.trim() || accumulatedResponse.length === 0) iterationResponse = iterationResponse.trimStart();
                            accumulatedResponse = iterationResponse;
                            throttledUpdate();
                        } else if (chunk.type === 'thinking') {
                            accumulatedThinking += chunk.content;
                            throttledUpdate();
                        } else if (chunk.type === 'sources') {
                            accumulatedSources = chunk.sources;
                            throttledUpdate();
                        } else if (chunk.type === 'function_call') {
                            // Ensure the tool call matches the expected ToolCall interface
                            const rawCall = chunk.call as any;
                            requestedCalls.push({
                                name: rawCall.name,
                                args: rawCall.args || rawCall.arguments || {}, // Handle both for safety
                                id: rawCall.id
                            });
                        }
                    }
                    // Providers that swallow the abort end normally: nothing of a stopped run is finalized
                    if (signal.aborted) return;

                    if (requestedCalls.length > 0 && llmConfig.enableToolCalling) {
                        logger.log('debug', '[AgenticLoop] Processing tool calls:', requestedCalls);
                        pendingBatch = requestedCalls;
                        batchResults = [];
                        batchModelText = buildToolTurnText(accumulatedResponse, accumulatedThinking, requestedCalls);
                        // Thinking streamed as text must stay visible while the tools run
                        accumulatedThinking = mergeTextThinking(accumulatedThinking, accumulatedResponse);
                    } else if (shouldNudgeModel(accumulatedResponse, accumulatedThinking, currentIteration, maxIterations)) {
                        // Only a short thought, no answer and no tool: ask the model to continue
                        conversationHistory = [
                            ...conversationHistory,
                            { id: `model_${Date.now()}`, role: 'model', text: accumulatedThinking, timestamp: new Date() },
                            {
                                id: `nudge_${Date.now()}`,
                                role: 'user',
                                text: 'Please continue. If you have finished the task, provide the final answer. If you need more information, use a tool.',
                                timestamp: new Date()
                            }
                        ];
                        accumulatedResponse = '';
                        accumulatedThinking = '';
                        currentIteration++; // A nudge is a step: the limit bounds repeated nudges too
                        continue;
                    } else {
                        break; // Final answer
                    }
                }

                // Run the batch in order. A call that needs confirmation pauses the run; the
                // decision resumes it on that same call.
                while (pendingBatch.length > 0) {
                    if (signal.aborted) return;
                    const call = pendingBatch[0];

                    if (pendingDecision) {
                        const { allowed } = pendingDecision;
                        pendingDecision = undefined;
                        pendingBatch.shift();
                        if (allowed) {
                            record(await runTool(call));
                        } else {
                            record({ name: call.name, success: false, result: 'User denied execution.' });
                            context.showToast(`Tool ${call.name} denied`, 'info');
                        }
                        continue;
                    }

                    if (isToolDenied(call.name, llmConfig.toolRules)) {
                        pendingBatch.shift();
                        record({ name: call.name, success: false, result: 'This tool is disabled in the user\'s settings.' });
                        continue;
                    }

                    if (needsConfirmation(call.name, llmConfig.toolConfirmationMode || 'dangerous', {}, llmConfig.toolRules)) {
                        logger.log('debug', '[AgenticLoop] Pausing for tool confirmation', call.name);
                        pausedAgentContextRef.current = {
                            conversationHistory,
                            modelMessageId,
                            currentIteration,
                            maxIterations,
                            accumulatedThinking,
                            accumulatedResponse,
                            accumulatedSources,
                            accumulatedToolResults,
                            iterationResponse: accumulatedResponse,
                            pendingToolCalls: [...pendingBatch],
                            batchResults,
                            batchModelText,
                            generatedImages
                        };
                        paused = true;
                        setPendingToolCall(call);
                        throttledUpdate(`⏸️ Waiting: ${call.name} requires confirmation...`);
                        return;
                    }

                    pendingBatch.shift();
                    record(await runTool(call));
                }
                if (signal.aborted) return;

                // Batch complete: the model turn that asked for the tools, then only their results
                conversationHistory = [
                    ...conversationHistory,
                    { id: `model_${Date.now()}`, role: 'model', text: batchModelText, timestamp: new Date() },
                    buildObservationMessage(batchResults, `tool_${Date.now()}`)
                ];
                batchResults = [];
                batchModelText = '';
                accumulatedResponse = '';
                currentIteration++;  // Increment AFTER tool execution (resumed batches count too)
            }

            // Fallback: If no response text but we have thinking, use thinking as the response
            let finalResponse = accumulatedResponse;
            if (!finalResponse.trim() && accumulatedThinking) {
                finalResponse = accumulatedThinking;
            }
            // Also fallback to tool results if nothing else
            if (!finalResponse.trim() && accumulatedToolResults.length > 0) {
                finalResponse = accumulatedToolResults.map(r => `${r.name}: ${r.result}`).join('\n\n');
            }
            // If we STILL have absolutely nothing, provide a safe fallback so the app doesn't hang
            if (!finalResponse.trim()) {
                finalResponse = "I apologize, but I wasn't able to generate a response. The context might be too large or complex.";
                accumulatedThinking = ""; // Clear confusing thoughts
            }

            // Extract inline memories before cleaning
            for (const memoryContent of extractInlineMemories(finalResponse)) {
                logger.log('info', `[MemoryExtraction] Inline memory found: "${memoryContent}"`);
                // 1. Save to explicit profile memory (Settings > Memory)
                context.addMemory(memoryContent, 'general');

                // 2. Save to semantic vector database (so it has the 'extracted' tag like before)
                if (llmConfig.enableSemanticMemory && activeThreadId) {
                    import('../../services/memory/semanticMemoryRetriever').then(async ({ getOrInitializeSemanticMemoryRetriever }) => {
                        try {
                            const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                            if (retriever) {
                                await retriever.saveMessage(activeThreadId, 'extracted', memoryContent);
                                logger.log('info', `[MemoryExtraction] Saved inline memory to semantic DB with role 'extracted'`);
                            }
                        } catch (e) {
                            logger.log('warn', '[MemoryExtraction] Failed to save to semantic DB', e);
                        }
                    }).catch(err => logger.log('warn', '[MemoryExtraction] Failed to import semantic retriever', err));
                }
            }

            const processedResponse = processCompletedResponse(cleanFinalAnswer(finalResponse), responseStyle);
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? {
                ...msg,
                text: processedResponse,
                thinking: accumulatedThinking || undefined,
                sources: accumulatedSources.length > 0 ? accumulatedSources : undefined,
                toolResults: accumulatedToolResults.length > 0 ? [...accumulatedToolResults] : undefined,
                images: generatedImages.length > 0 ? [...generatedImages] : undefined
            } : msg));

            if (autoPlayAudio && processedResponse) {
                setIsSpeaking(true);
                speak(processedResponse, speechConfig.ttsProvider, llmConfig, speechConfig, apiKeys.gemini, () => setIsSpeaking(false));
            }
            // NOTE: model responses are not saved to semantic memory: MemoryExtractionService
            // stores the important facts instead (only user messages help retrieval)

        } catch (error: any) {
            // Errors of a stopped run (AbortError, "Generation aborted by user") are not shown
            if (signal.aborted || error?.name === 'AbortError') return;
            const errorMessageText = `Sorry, I encountered an error: ${error.message || 'Please try again.'} `;
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, text: errorMessageText } : msg));
        } finally {
            // Only the run that still owns the shared state resets it (Stop already did otherwise).
            // While paused on a confirmation the bubble keeps its "processing" state.
            if (isActiveRun()) {
                abortControllerRef.current = null;
                if (!paused) {
                    setIsLoading(false);
                    allowSleep();
                }
            }
        }
    }, [
        llmConfig, personality, context, apiKeys, responseStyle, speechConfig, autoPlayAudio, activeThreadId,
        serverSettings, setMessages, setIsLoading, setIsSpeaking, compressHistoryIfNeeded, allowSleep
    ]);

    const handleConfirmTool = useCallback(async (allowed: boolean, remember: boolean) => {
        const paused = pausedAgentContextRef.current;
        const call = pendingToolCall;

        if (!paused || !call) return;
        // The resumed run owns this state now: an error in it must not leave the app "busy"
        pausedAgentContextRef.current = null;
        setPendingToolCall(null);

        if (remember && allowed && onUpdateToolRules) {
            // Save the tool as 'allow' in toolRules for future auto-approval
            onUpdateToolRules(call.name, 'allow');
        }

        // Resume loop with the decision for the call that paused it
        runAgenticLoop([], paused, { allowed });

    }, [pendingToolCall, runAgenticLoop, onUpdateToolRules]);

    return {
        pendingToolCall,
        setPendingToolCall,
        stopGeneration,
        runAgenticLoop,
        handleConfirmTool,
        isBusy
    };
};
