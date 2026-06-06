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
import { executeTool, needsConfirmation } from '../../services/tools';
import { useContextCompression } from './useContextCompression';
import { estimateTokens } from '../../services/llm/context/unifiedContextManager';

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

export const useAgenticLoop = ({
// ... (rest of hook setup)
    llmConfig,
    personality,
    speechConfig,
    apiKeys,
    responseStyle,
    autoPlayAudio,
    context,
    activeThreadId: _activeThreadId,
    onUpdateToolRules,
    setMessages,
    setIsLoading,
    setIsSpeaking,
    serverSettings
}: UseAgenticLoopProps) => {
    const [pendingToolCall, setPendingToolCall] = useState<ToolCall | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const pausedAgentContextRef = useRef<AgentContext | null>(null);
    const toolCallSourceRef = useRef<string | null>(null);

    const { compressHistoryIfNeeded } = useContextCompression();

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            triggerHaptic('MEDIUM');
        }
    }, [setIsLoading]);

    /**
     * Core Agentic Loop
     */
    const runAgenticLoop = useCallback(async (
        initialHistory: Message[],
        resumeContext?: AgentContext,
        decision?: { allowed: boolean; toolName: string }
    ) => {
        logger.log('info', `[LLM_CHAIN] =======================================`);
        logger.log('info', `[LLM_CHAIN] USER CLICKED SEND / runAgenticLoop initiated`);
        logger.log('info', `[LLM_CHAIN] =======================================`);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();

        if (llmConfig.keepScreenOn && Capacitor.isNativePlatform()) {
            try { KeepAwake.keepAwake(); } catch (e) { }
        }

        let conversationHistory = resumeContext ? [...resumeContext.conversationHistory] : [...initialHistory];
        const modelMessageId = resumeContext ? resumeContext.modelMessageId : (Date.now() + 1).toString();
        const maxIterations = llmConfig.maxAgentIterations || 5;
        let currentIteration = resumeContext ? resumeContext.currentIteration : 0;

        let accumulatedResponse = resumeContext ? resumeContext.accumulatedResponse : '';
        let accumulatedThinking = resumeContext ? resumeContext.accumulatedThinking : '';
        let accumulatedSources = resumeContext ? [...resumeContext.accumulatedSources] : [];
        let accumulatedToolResults = resumeContext ? [...resumeContext.accumulatedToolResults] : [];

        let hasMoreToolCalls = true;
        let toolCallsToExecute: ToolCall[] = [];

        if (!resumeContext) {
            const modelMessage: Message = { id: modelMessageId, role: 'model', text: '', timestamp: new Date() };
            setMessages(_prev => [...initialHistory, modelMessage]);
        }

        let lastUpdateTimestamp = 0;
        const throttledUpdate = (text: string, thinking?: string, sources?: any[], toolResults?: any[], status?: string) => {
            const now = Date.now();
            if (!status && now - lastUpdateTimestamp < 100) return;
            lastUpdateTimestamp = now;

            let cleanText = text ? text.replace(/^\s+/, '') : '';
            const answerMatch = cleanText.match(/(?:^|\n)(?:Final )?Answer:\s*/i);
            if (answerMatch && answerMatch.index !== undefined) {
                // We found an Answer: block, only show what comes after it
                cleanText = cleanText.substring(answerMatch.index + answerMatch[0].length);
            } else if (cleanText.includes('<tool>') || cleanText.includes('</tool>')) {
                // If it's a tool block without Answer:, don't show the tool call JSON to the user
                cleanText = '';
            }
            const cleanThinking = thinking ? thinking.replace(/^\s+/, '') : undefined;
            
            // Clean inline memory tags so they don't show on screen
            cleanText = cleanText.replace(/<save_memory>[\s\S]*?(?:<\/save_memory>|$)/gi, '');
            
            const displayText = status ? (cleanText ? `${cleanText}\n\n_${status}_` : `_${status}_`) : cleanText;

            logger.log('debug', `[LLM_CHAIN] UI UPDATE (throttled): Text length=${displayText.length}, updating React state.`);
            setMessages(prev => prev.map(msg =>
                msg.id === modelMessageId ? { ...msg, text: displayText, thinking: cleanThinking, sources, toolResults } : msg
            ));
        };

        try {
            // Helper for tool execution used in both Resume and Loop phases
            const toolContext = {
                todos: context.todos,
                memories: context.memories,
                addTodo: context.addTodo,
                completeTodo: context.completeTodo,
                addMemory: context.addMemory,
                confirmationMode: llmConfig.toolConfirmationMode || 'dangerous',
                llmConfig: llmConfig // Add missing property
            };

            let effectiveApiKey = apiKeys.gemini;
            if (llmConfig.provider === 'perplexity') effectiveApiKey = apiKeys.perplexity;
            if (llmConfig.provider === 'claude') effectiveApiKey = apiKeys.claude;

            const executeSingleTool = async (call: ToolCall) => {
                logger.log('debug', '[AgenticLoop] Executing tool:', call.name);
                throttledUpdate(accumulatedResponse, accumulatedThinking || undefined, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined, `🔧 Executing: ${call.name.split(' ')[0].split('(')[0].trim()}...`);
                try {
                    const result = await executeTool(call, toolContext);
                    let cleanResult = result.message.split('\n\n').filter((b: string) => !b.trim().startsWith('[SYSTEM')).join('\n\n').trim();
                    
                    // Tool Output Pruning: Summarize long tool outputs
                    if (estimateTokens(cleanResult) > 800) { 
                        throttledUpdate(accumulatedResponse, accumulatedThinking || undefined, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined, `✂️ Summarizing large result from ${call.name.split(' ')[0].split('(')[0].trim()}...`);
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

                    accumulatedToolResults.push({ name: call.name, success: result.success, result: cleanResult });
                    context.showToast(result.message.substring(0, 80) + (result.message.length > 80 ? '...' : ''), result.success ? 'success' : 'error');
                    return cleanResult; // Return raw result for cleaner formatting
                } catch (error) {
                    accumulatedToolResults.push({ name: call.name, success: false, result: (error as Error).message });
                    return `Error: ${(error as Error).message}`;
                }
            };

            if (resumeContext) {

                const allPending = [...resumeContext.pendingToolCalls];

                // Process the adjudged tool first
                if (decision) {
                    const toolIndex = allPending.findIndex(t => t.name === decision.toolName);
                    if (toolIndex !== -1) {
                        const toolToProcess = allPending[toolIndex];
                        // Remove from pending list
                        allPending.splice(toolIndex, 1);

                        if (decision.allowed) {
                            await executeSingleTool(toolToProcess);
                        } else {
                            accumulatedToolResults.push({ name: toolToProcess.name, success: false, result: 'User denied execution.' });
                            context.showToast(`Tool ${toolToProcess.name} denied`, 'info');
                        }
                    }
                }

                // CRITICAL: Add the tool result to conversation history BEFORE continuing
                // This was missing - causing the loop to call the model without the tool result
                if (accumulatedToolResults.length > 0) {
                    const toolResultsStr = accumulatedToolResults.map(r =>
                        `[${r.name}]: ${r.success ? r.result : `Failed - ${r.result}`}`
                    );
                    const toolResultMessage: Message = {
                        id: `tool_${Date.now()}`,
                        role: 'user',
                        text: `Observation:\n${toolResultsStr.join('\n\n')}`,
                        timestamp: new Date()
                    };

                    const modelTurnForHistory: Message = {
                        id: `model_${Date.now()}`,
                        role: 'model',
                        text: resumeContext.accumulatedResponse ||
                            resumeContext.pendingToolCalls.map(c =>
                                `<tool>${c.name}(${JSON.stringify(c.args)})</tool>`).join('\n'),
                        timestamp: new Date()
                    };

                    conversationHistory = [
                        ...conversationHistory,
                        modelTurnForHistory,
                        toolResultMessage
                    ];
                }

                // Set remaining tools to be executed in the loop
                toolCallsToExecute = allPending;
                hasMoreToolCalls = true;
            }

            while (hasMoreToolCalls && currentIteration < maxIterations) {
                if (!abortControllerRef.current) break;

                if (toolCallsToExecute.length === 0) {
                    hasMoreToolCalls = false;

                    if (currentIteration > 0) {
                        throttledUpdate(accumulatedResponse, accumulatedThinking || undefined, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined, `🔄 Reasoning step ${currentIteration} of ${maxIterations}...`);
                    }

                    // Compress history aggressively for mobile GPU (Gemma 3n ~4k context)
                    conversationHistory = compressHistoryIfNeeded(conversationHistory, 1500);

                    const stream = await generateTextResponseStreamWithTools(
                        conversationHistory,
                        personality,
                        llmConfig,
                        context.memories,
                        effectiveApiKey,
                        abortControllerRef.current.signal,
                        getMaxTokensForStyle(responseStyle),
                        serverSettings
                    );

                    let iterationResponse = '';
                    let iterationThinking = '';

                    for await (const chunk of stream) {
                        const content = chunk.type === 'text' || chunk.type === 'thinking' ? chunk.content : '';
                        logger.log('debug', `[LLM_CHAIN] AgenticLoop received chunk: type=${chunk.type}, content=[${content?.replace(/\n/g, '\\n')}]`);
                        if (chunk.type === 'text') {
                            iterationResponse += chunk.content;
                            if (!iterationResponse.trim()) iterationResponse = iterationResponse.trimStart();
                            else if (accumulatedResponse.length === 0) iterationResponse = iterationResponse.trimStart();
                            accumulatedResponse = iterationResponse;
                            throttledUpdate(accumulatedResponse, accumulatedThinking + iterationThinking || undefined, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined);
                        } else if (chunk.type === 'thinking') {
                            iterationThinking += chunk.content;
                            accumulatedThinking += chunk.content;
                            throttledUpdate(accumulatedResponse, accumulatedThinking, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined);
                        } else if (chunk.type === 'sources') {
                            accumulatedSources = chunk.sources;
                            throttledUpdate(accumulatedResponse, accumulatedThinking || undefined, accumulatedSources, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined);
                        } else if (chunk.type === 'function_call') {
                            // Ensure the tool call matches the expected ToolCall interface
                            const rawCall = chunk.call as any;
                            const toolCall: ToolCall = {
                                name: rawCall.name,
                                args: rawCall.args || rawCall.arguments || {}, // Handle both for safety
                                id: rawCall.id
                            };
                            toolCallsToExecute.push(toolCall);
                        }
                    }
                }

                if (toolCallsToExecute.length > 0 && llmConfig.enableToolCalling) {
                    logger.log('debug', '[AgenticLoop] Processing tool calls:', toolCallsToExecute);
                    hasMoreToolCalls = true;

                    const needsConfirmTools = toolCallsToExecute.filter(call =>
                        needsConfirmation(call.name, llmConfig.toolConfirmationMode || 'dangerous', {}, llmConfig.toolRules)
                    );

                    if (needsConfirmTools.length > 0) {
                        logger.log('debug', '[AgenticLoop] Pausing for tool confirmation', needsConfirmTools[0].name);
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
                            pendingToolCalls: toolCallsToExecute
                        };

                        setPendingToolCall(needsConfirmTools[0]);
                        toolCallSourceRef.current = modelMessageId;
                        throttledUpdate(accumulatedResponse, accumulatedThinking || undefined, accumulatedSources.length > 0 ? accumulatedSources : undefined, accumulatedToolResults.length > 0 ? accumulatedToolResults : undefined, `⏸️ Waiting: ${needsConfirmTools[0].name} requires confirmation...`);
                        return;
                    }

                    const toolResultsStr: string[] = [];
                    for (const call of toolCallsToExecute) {
                        if (!abortControllerRef.current) break;
                        const resStr = await executeSingleTool(call);
                        toolResultsStr.push(`[${call.name}]: ${resStr}`);
                    }

                    const toolResultMessage: Message = {
                        id: `tool_${Date.now()}`,
                        role: 'user',
                        text: `Observation:\n${toolResultsStr.join('\n\n')}`,
                        timestamp: new Date()
                    };

                    // Reconstruct the full model response including thinking and tool calls for history
                    // [FIX] Clean duplication: Strip raw tags from the text part since we'll restructure it canonically
                    let cleanBody = accumulatedResponse
                        .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/g, '')
                        .replace(/<tool>[\s\S]*?(?:<\/tool>|$)/g, '')
                        .replace(/\[tool\][\s\S]*?(?:\[\/tool\]|$)/g, '')
                        .trim();
                    const historyAnswerMatch = cleanBody.match(/(?:^|\n)(?:Final )?Answer:\s*/i);
                    if (historyAnswerMatch && historyAnswerMatch.index !== undefined) {
                        // We found an Answer: block, only save what comes after it
                        cleanBody = cleanBody.substring(historyAnswerMatch.index + historyAnswerMatch[0].length);
                    } else if (accumulatedResponse.includes('<tool>') || accumulatedResponse.includes('</tool>')) {
                        // CRITICAL ANTI-LEAK: If the model called a tool but FORGOT the "Answer:" prefix,
                        // any text it produced before the tool is just conversational fluff ("I will now search...").
                        // We MUST discard it, otherwise it gets pushed to history as a final reply and the model repeats it.
                        cleanBody = '';
                    }

                    let fullModelResponse = '';

                    if (accumulatedThinking) {
                        fullModelResponse += `<thinking>${accumulatedThinking}</thinking>\n`;
                    }

                    if (cleanBody) {
                        fullModelResponse += `${cleanBody}\n`;
                    }

                    // Add tool usage to history if it wasn't already part of the text
                    if (toolCallsToExecute.length > 0) {
                        const toolCallsStr = toolCallsToExecute
                            .map(call =>
                                `<tool>${call.name}(${JSON.stringify(call.args)})</tool>`
                            ).join('\n');

                        fullModelResponse += `${toolCallsStr}`;
                    }

                    conversationHistory = [
                        ...conversationHistory,
                        { id: `model_${Date.now()}`, role: 'model', text: fullModelResponse.trim(), timestamp: new Date() },
                        toolResultMessage
                    ];

                    // [CRITICAL FIX] Robust Thinking Preservation
                    // Before clearing accumulatedResponse, we must check if it contains any thinking blocks 
                    // that were streamed as 'text' instead of 'thinking' chunks.
                    // This prevents the thinking block from disappearing when tool execution starts.
                    const textThinkingMatch = accumulatedResponse.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/);
                    if (textThinkingMatch) {
                        // Strip any nested tags that might have broken the regex or leaked
                        let extractedThinking = textThinkingMatch[1]
                            .replace(/<thinking>/g, '')
                            .replace(/<\/thinking>/g, '')
                            .replace(/<tool>[\s\S]*?(?:<\/tool>|$)/g, '')
                            .replace(/\[tool\][\s\S]*?(?:\[\/tool\]|$)/g, '')
                            .trim();

                        if (extractedThinking && !accumulatedThinking.includes(extractedThinking)) {
                            // Append only if not already in accumulatedThinking (avoid duplication)
                            accumulatedThinking = (accumulatedThinking + '\n' + extractedThinking).trim();
                        }
                    }

                    accumulatedResponse = '';
                    // accumulatedThinking = ''; // PRESERVE THINKING across iterations
                    toolCallsToExecute = [];
                    currentIteration++;  // Increment AFTER tool execution

                } else {
                    // Self-correction: Only nudge if model produced ONLY thinking with no substantive answer
                    // A substantive answer is:
                    // 1. accumulatedResponse has meaningful content (>50 chars outside thinking tags)
                    // 2. accumulatedThinking contains a complete answer (describes something, answers a question)
                    // 3. Model is responding to an image/audio analysis request (no tools needed)

                    const cleanResponse = accumulatedResponse.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                    const hasSubstantiveResponse = cleanResponse.length > 0 && cleanResponse !== '<'; // Reject lone '<'

                    // Check if thinking contains a direct answer (not just reasoning steps)
                    const thinkingHasAnswer = accumulatedThinking && (
                        accumulatedThinking.toLowerCase().includes('the image') ||
                        accumulatedThinking.toLowerCase().includes('the picture') ||
                        accumulatedThinking.toLowerCase().includes('the audio') ||
                        accumulatedThinking.toLowerCase().includes('i see') ||
                        accumulatedThinking.toLowerCase().includes('this shows') ||
                        accumulatedThinking.length > 200  // Long thinking usually contains answer
                    );

                    // Only nudge if: short thinking, no response, AND not an obvious direct answer
                    const shouldNudge = !hasSubstantiveResponse &&
                        !thinkingHasAnswer &&
                        accumulatedThinking &&
                        accumulatedThinking.length > 5 &&
                        accumulatedThinking.length < 80 &&  // Only nudge for extremely short/empty thoughts
                        currentIteration < maxIterations - 1;

                    if (shouldNudge) {
                        // Model didn't call a tool or provide answer - nudge it
                        const nudgeMessage: Message = {
                            id: `nudge_${Date.now()}`,
                            role: 'user',
                            text: 'Please continue. If you have finished the task, provide the final answer. If you need more information, use a tool.',
                            timestamp: new Date()
                        };
                        conversationHistory = [
                            ...conversationHistory,
                            { id: `model_${Date.now()}`, role: 'model', text: accumulatedThinking, timestamp: new Date() },
                            nudgeMessage
                        ];
                        hasMoreToolCalls = true;
                        accumulatedResponse = '';
                        accumulatedThinking = '';
                        toolCallsToExecute = [];
                    } else {
                        hasMoreToolCalls = false;
                    }
                }
            }

            // Fallback: If no response text but we have thinking, use thinking as the response
            let finalResponse = accumulatedResponse;
            if (!finalResponse.trim() && accumulatedThinking) {
                // Only fallback to thinking if we actually generated some in this iteration or we have nothing else
                // If the model was totally silent, returning old thoughts makes it look like it repeated itself.
                finalResponse = accumulatedThinking;
            }
            // Also fallback to tool results if nothing else
            if (!finalResponse.trim() && accumulatedToolResults.length > 0) {
                finalResponse = accumulatedToolResults.map(r => `${r.name}: ${r.result}`).join('\n\n');
            }

            // If we STILL have absolutely nothing, provide a safe fallback so the app doesn't hang
            // or repeat the previous message endlessly.
            if (!finalResponse.trim()) {
                finalResponse = "I apologize, but I wasn't able to generate a response. The context might be too large or complex.";
                accumulatedThinking = ""; // Clear confusing thoughts
            }

            // Extract inline memories before cleaning
            // We use a regex that handles both closed and unclosed (at end of string) tags
            const memoryMatches = finalResponse.match(/<save_memory>([\s\S]*?)(?:<\/save_memory>|$)/ig);
            if (memoryMatches) {
                for (const match of memoryMatches) {
                    const memoryContent = match.replace(/<\/?save_memory>/ig, '').trim();
                    if (memoryContent) {
                        logger.log('info', `[MemoryExtraction] Inline memory found: "${memoryContent}"`);
                        
                        // 1. Save to explicit profile memory (Settings > Memory)
                        context.addMemory(memoryContent, 'general');
                        
                        // 2. Save to semantic vector database (so it has the 'extracted' tag like before)
                        if (llmConfig.enableSemanticMemory && _activeThreadId) {
                            import('../../services/memory/semanticMemoryRetriever').then(async ({ getOrInitializeSemanticMemoryRetriever }) => {
                                try {
                                    const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                                    if (retriever) {
                                        await retriever.saveMessage(_activeThreadId, 'extracted', memoryContent);
                                        logger.log('info', `[MemoryExtraction] Saved inline memory to semantic DB with role 'extracted'`);
                                    }
                                } catch (e) {
                                    logger.log('warn', '[MemoryExtraction] Failed to save to semantic DB', e);
                                }
                            }).catch(err => logger.log('warn', '[MemoryExtraction] Failed to import semantic retriever', err));
                        }
                    }
                }
            }

            // Clean up any status messages (like "🔄 Reasoning step...") from the final response
            let cleanFinalResponse = finalResponse
                .replace(/_🔄 Reasoning step \d+ of \d+\.\.._/g, '')
                .replace(/<thinking>[\s\S]*?(?:<\/thinking>|$)/g, '')
                .replace(/<tool>[\s\S]*?(?:<\/tool>|$)/g, '')
                .replace(/\[tool\][\s\S]*?(?:\[\/tool\]|$)/g, '')
                .replace(/<save_memory>[\s\S]*?(?:<\/save_memory>|$)/ig, '')
                .trim();

            const finalAnswerMatch = cleanFinalResponse.match(/(?:^|\n)(?:Final )?Answer:\s*/i);
            if (finalAnswerMatch && finalAnswerMatch.index !== undefined) {
                // We found an Answer: block, only save what comes after it
                cleanFinalResponse = cleanFinalResponse.substring(finalAnswerMatch.index + finalAnswerMatch[0].length);
            } else if (finalResponse.includes('<tool>') || finalResponse.includes('</tool>')) {
                // If the model called a tool but FORGOT the "Answer:" prefix,
                // the text is merely conversational reasoning ("I will search...").
                // Hide it from the final UI response so it doesn't leak.
                cleanFinalResponse = '';
            }

            const processedResponse = processCompletedResponse(cleanFinalResponse, responseStyle);
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, text: processedResponse, thinking: accumulatedThinking || undefined, sources: accumulatedSources.length > 0 ? accumulatedSources : undefined } : msg));

            if (autoPlayAudio && processedResponse) {
                setIsSpeaking(true);
                speak(processedResponse, speechConfig.ttsProvider, llmConfig, speechConfig, apiKeys.gemini, () => setIsSpeaking(false));
            }

            // NOTE: We don't save model responses to semantic memory anymore
            // - They waste space with verbose assistant text
            // - The MemoryExtractionService extracts and saves important facts instead
            // - Only user messages are useful for semantic retrieval
            // if (processedResponse) {
            //     saveToSemanticMemory('model', processedResponse);
            // }

            // Clear paused context - loop is complete
            pausedAgentContextRef.current = null;

        } catch (error: any) {
            if (error.name === 'AbortError') return;
            const errorMessageText = `Sorry, I encountered an error: ${error.message || 'Please try again.'} `;
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, text: errorMessageText } : msg));
        } finally {
            if (!pausedAgentContextRef.current) {
                setIsLoading(false);
                abortControllerRef.current = null;
                if (llmConfig.keepScreenOn && Capacitor.isNativePlatform()) {
                    try { await KeepAwake.allowSleep(); } catch (e) { }
                }
            }
            // If paused (waiting for tool confirmation), we KEEP isLoading=true
            // so the UI remains in "processing" state and doesn't trigger auto-focus.
            setPendingToolCall(prev => prev); // Trigger re-render if needed? No, state already set.
        }
    }, [
        llmConfig, personality, context, apiKeys, responseStyle, speechConfig, autoPlayAudio,
        getMaxTokensForStyle, generateTextResponseStreamWithTools, processCompletedResponse,
        setMessages, setIsLoading, setIsSpeaking, compressHistoryIfNeeded
    ]);

    const handleConfirmTool = useCallback(async (allowed: boolean, remember: boolean) => {
        const context = pausedAgentContextRef.current;
        const call = pendingToolCall;

        if (!context || !call) return;
        setPendingToolCall(null);

        if (remember && allowed && onUpdateToolRules) {
            // Save the tool as 'allow' in toolRules for future auto-approval
            onUpdateToolRules(call.name, 'allow');
        }

        // Resume loop with decision
        runAgenticLoop([], context, { allowed, toolName: call.name });

    }, [pendingToolCall, runAgenticLoop, onUpdateToolRules]);

    return {
        pendingToolCall,
        setPendingToolCall,
        stopGeneration,
        runAgenticLoop,
        handleConfirmTool
    };
};
