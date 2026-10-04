import { useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Message, Personality, LLMConfig, SpeechConfig, ResponseStyle, AIMindMeshServerSettings } from '../../types';
import { ChatContext, ApiKeys, AgentContext, ToolCall } from './types';
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
import { beginChatActivity } from '../../services/llm/background/chatActivity';
import { imageFromToolData, resolveToolSourceImage } from '../../services/image/imagePrompt';
import { lastUserText } from '../../services/llm/roles';
import { isOnDeviceProvider } from '../../services/llm/providerKeys';
import { memoryTaskConfig } from '../../services/memory/memoryLlmConfig';
import { resolveLanguage } from '../../services/llm/prompt/languageRule';
import { runAgent, type AgentDeps, type AgentRunState } from '../../services/agent/agentRunner';
import {
    effectiveProvider, apiKeyForProvider, compressionBudget, streamDisplayText, mergeSources, findUserRequest, buildToolSummaryPrompt
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
     * Agentic run of one user turn, through the shared agent runner (services/agent/agentRunner):
     * this hook supplies generation, tool execution, confirmations and the chat bubble.
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
        const endActivity = beginChatActivity();

        if (llmConfig.keepScreenOn && Capacitor.isNativePlatform()) {
            try { KeepAwake.keepAwake(); } catch (e) { }
        }

        const modelMessageId = resumeContext ? resumeContext.modelMessageId : (Date.now() + 1).toString();
        if (!resumeContext) {
            const modelMessage: Message = { id: modelMessageId, role: 'model', text: '', timestamp: new Date() };
            setMessages(_prev => [...initialHistory, modelMessage]);
        }

        let lastUpdateTimestamp = 0;
        const updateBubble = (state: AgentRunState, status?: string) => {
            if (signal.aborted) return; // A stopped run no longer writes into the bubble
            const now = Date.now();
            if (!status && now - lastUpdateTimestamp < 100) return;
            lastUpdateTimestamp = now;
            const displayText = streamDisplayText(state.accumulatedResponse, status);
            const thinking = state.accumulatedThinking.replace(/^\s+/, '') || undefined;
            const sources = state.accumulatedSources.length > 0 ? state.accumulatedSources : undefined;
            const toolResults = state.accumulatedToolResults.length > 0 ? [...state.accumulatedToolResults] : undefined;
            const images = state.generatedImages.length > 0 ? [...state.generatedImages] : undefined;
            setMessages(prev => prev.map(msg =>
                msg.id === modelMessageId ? { ...msg, text: displayText, thinking, sources, toolResults, images } : msg
            ));
        };

        try {
            const toolContext = {
                todos: context.todos,
                addTodo: context.addTodo,
                completeTodo: context.completeTodo,
                confirmationMode: llmConfig.toolConfirmationMode || 'dangerous',
                llmConfig: llmConfig
            };
            const provider = effectiveProvider(llmConfig, serverSettings);
            const effectiveApiKey = apiKeyForProvider(provider, apiKeys, llmConfig);
            const maxResponseTokens = getMaxTokensForStyle(responseStyle);
            const historyBudget = compressionBudget(provider, llmConfig, maxResponseTokens);
            const onDevice = isOnDeviceProvider(provider);
            const language = resolveLanguage(llmConfig.assistantLanguage, [lastUserText(resumeContext?.conversationHistory ?? initialHistory)]);

            const deps: AgentDeps = {
                generate: (history, config, sig) =>
                    generateTextResponseStreamWithTools(history, personality, config, effectiveApiKey, sig, maxResponseTokens, serverSettings),
                runTool: async (call, state) => {
                    logger.log('debug', '[AgenticLoop] Executing tool:', call.name);
                    updateBubble(state, `🔧 Executing: ${toolLabel(call.name)}...`);
                    try {
                        if (call.name === 'generate_image' && call.args?.source_image) {
                            // The model names the image to edit ("last"); the pixels come from the chat
                            const { source, error } = resolveToolSourceImage(call.args.source_image, state.conversationHistory, state.generatedImages);
                            if (error) return { name: call.name, success: false, result: error };
                            call = { ...call, args: { ...call.args, source_image: source } };
                        }
                        const result = await executeTool(call, toolContext);
                        const image = imageFromToolData(result.data);
                        if (image) state.generatedImages.push(image); // shown in the bubble, never sent back to the model
                        state.accumulatedSources = mergeSources(state.accumulatedSources, result.sources); // web pages behind the answer
                        let cleanResult = result.message.split('\n\n').filter((b: string) => !b.trim().startsWith('[SYSTEM')).join('\n\n').trim();
                        // Long tool outputs are summarized as an internal task (no persona, memories or tools)
                        if (estimateTokens(cleanResult) > 800 && !signal.aborted) {
                            updateBubble(state, `✂️ Summarizing large result from ${toolLabel(call.name)}...`);
                            try {
                                const summary = await generateMemorySummary(buildToolSummaryPrompt(cleanResult, findUserRequest(state.conversationHistory)), memoryTaskConfig(llmConfig), effectiveApiKey);
                                if (summary) cleanResult = `[Summarized by system due to length]\n${summary}`;
                            } catch (e) {
                                logger.log('warn', '[AgenticLoop] Failed to summarize tool output, truncating instead');
                            }
                        }
                        cleanResult = cleanResult.substring(0, 4000);
                        context.showToast(result.message.substring(0, 80) + (result.message.length > 80 ? '...' : ''), result.success ? 'success' : 'error');
                        return { name: call.name, success: result.success, result: cleanResult };
                    } catch (error) {
                        return { name: call.name, success: false, result: (error as Error).message };
                    }
                },
                isDenied: call => isToolDenied(call.name, llmConfig.toolRules),
                needsConfirmation: call => needsConfirmation(call.name, llmConfig.toolConfirmationMode || 'dangerous', {}, llmConfig.toolRules),
                // On-device models have a small window; remote ones prune by themselves
                compress: Number.isFinite(historyBudget) ? history => compressHistoryIfNeeded(history, historyBudget) : undefined,
                update: updateBubble,
                log: (level, message) => logger.log(level, message),
            };

            const history = resumeContext ? [] : applyContextSummary([...initialHistory], activeThreadId ?? getActiveThreadId());
            const outcome = await runAgent({
                history, config: llmConfig, onDevice, language, threadId: activeThreadId ?? getActiveThreadId(),
                resume: resumeContext ? { state: toRunState(resumeContext), decision } : undefined,
            }, deps, signal);

            if (outcome.status === 'aborted') return;
            if (outcome.status === 'paused') {
                logger.log('debug', '[AgenticLoop] Pausing for tool confirmation', outcome.call.name);
                pausedAgentContextRef.current = toAgentContext(outcome.state, modelMessageId);
                paused = true;
                setPendingToolCall(outcome.call);
                updateBubble(outcome.state, `⏸️ Waiting: ${outcome.call.name} requires confirmation...`);
                return;
            }

            const { state } = outcome;
            let finalResponse = outcome.text;
            if (!finalResponse.trim() && state.accumulatedToolResults.length > 0) {
                finalResponse = state.accumulatedToolResults.map(r => `${r.name}: ${r.result}`).join('\n\n');
            }
            let thinking = outcome.thinking;
            if (!finalResponse.trim()) {
                finalResponse = "I apologize, but I wasn't able to generate a response. The context might be too large or complex.";
                thinking = '';
            }

            const processedResponse = processCompletedResponse(finalResponse, responseStyle);
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? {
                ...msg,
                text: processedResponse,
                thinking: thinking || undefined,
                sources: state.accumulatedSources.length > 0 ? state.accumulatedSources : undefined,
                toolResults: state.accumulatedToolResults.length > 0 ? [...state.accumulatedToolResults] : undefined,
                images: state.generatedImages.length > 0 ? [...state.generatedImages] : undefined
            } : msg));

            if (autoPlayAudio && processedResponse) {
                setIsSpeaking(true);
                speak(processedResponse, speechConfig.ttsProvider, llmConfig, speechConfig, apiKeys.gemini, () => setIsSpeaking(false));
            }
            // Facts are not written here: the background consolidation reads the conversation

        } catch (error: any) {
            // Errors of a stopped run (AbortError, "Generation aborted by user") are not shown
            if (signal.aborted || error?.name === 'AbortError') return;
            const errorMessageText = `Sorry, I encountered an error: ${error.message || 'Please try again.'} `;
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, text: errorMessageText } : msg));
        } finally {
            endActivity();
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

/** Run state ↔ the paused context kept while a confirmation is pending */
function toRunState(ctx: AgentContext): AgentRunState {
    return {
        conversationHistory: [...ctx.conversationHistory], currentIteration: ctx.currentIteration, maxIterations: ctx.maxIterations,
        accumulatedResponse: ctx.accumulatedResponse, accumulatedThinking: ctx.accumulatedThinking,
        accumulatedSources: [...ctx.accumulatedSources], accumulatedToolResults: [...ctx.accumulatedToolResults],
        generatedImages: [...(ctx.generatedImages || [])], pendingToolCalls: [...ctx.pendingToolCalls],
        batchResults: [...(ctx.batchResults || [])], batchModelText: ctx.batchModelText ?? '', executed: [...(ctx.executed || [])], batchCalls: [...(ctx.batchCalls || [])],
    };
}

function toAgentContext(state: AgentRunState, modelMessageId: string): AgentContext {
    return {
        conversationHistory: state.conversationHistory, modelMessageId, currentIteration: state.currentIteration,
        maxIterations: state.maxIterations, accumulatedThinking: state.accumulatedThinking, accumulatedResponse: state.accumulatedResponse,
        accumulatedSources: state.accumulatedSources, accumulatedToolResults: state.accumulatedToolResults,
        iterationResponse: state.accumulatedResponse, pendingToolCalls: [...state.pendingToolCalls], batchResults: state.batchResults,
        batchModelText: state.batchModelText, generatedImages: state.generatedImages, executed: state.executed,
        batchCalls: state.batchCalls,
    };
}
