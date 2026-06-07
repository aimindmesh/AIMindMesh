import { Message, LLMConfig, Personality, Memory } from '../../../../types';
import { logger } from '../../../logger';
import { buildSystemPrompt } from '../../promptBuilder';
import { getReActSystemPromptAddition, getReActSystemPromptCompact } from '../../../toolDefinitions';
import { getOrInitializeSemanticMemoryRetriever } from '../../../memory/semanticMemoryRetriever';
import { refineContext } from '../../context/unifiedContextManager';

// Helper to check if tool calling is enabled
const isToolCallingEnabled = (llmConfig: LLMConfig): boolean => {
    return llmConfig.enableToolCalling === true;
};

// Helper to derive a response length hint from the token count
export const getResponseHintFromTokens = (maxTokens?: number): string | undefined => {
    if (!maxTokens) return undefined;

    if (maxTokens <= 200) {
        return "Answer very briefly and directly. Use 1-3 sentences maximum. Avoid long explanations.";
    } else if (maxTokens <= 500) {
        return "Answer clearly and completely, but without being too wordy. Use short paragraphs and get to the point.";
    } else {
        return "You can provide detailed and in-depth answers when the topic requires it.";
    }
};

export async function prepareContext(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories?: Memory[],
    maxResponseLength?: number
): Promise<{ systemPrompt: string; updatedHistory: Message[]; }> {
    const responseHint = getResponseHintFromTokens(maxResponseLength);

    // If semantic memory is enabled, we STILL pass the manual memory list to buildSystemPrompt.
    // Explicit/Pinned memories should always be present.
    // We will append the relevant semantic context (from past conversations) shortly after.
    let systemPrompt = buildSystemPrompt(
        personality, 
        llmConfig?.enableSemanticMemory ? undefined : memories,
        responseHint, 
        true       // enableInlineMemory for local models
    );
    logger.log('info', `[LLM_CHAIN] Base system prompt built. Length: ${systemPrompt.length}`);

    let updatedHistory = [...history];
    // Retrieve semantically relevant memories if enabled
    if (llmConfig.enableSemanticMemory && llmConfig.embeddingModelId && updatedHistory.length > 0) {
        logger.log('info', '[LLM_CHAIN] Semantic memory enabled. Attempting retrieval...');
        try {
            // Find the index of the last user message
            let lastUserIndex = -1;
            for (let i = updatedHistory.length - 1; i >= 0; i--) {
                if (updatedHistory[i].role === 'user') {
                    lastUserIndex = i;
                    break;
                }
            }

            if (lastUserIndex !== -1) {
                const lastUserMessage = updatedHistory[lastUserIndex];
                logger.log('debug', `[LLM_CHAIN] Querying semantic memory for: "${lastUserMessage.text.substring(0, 50)}..."`);
                const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
                if (retriever) {
                    const relevantMemories = await retriever.retrieveRelevantMemories(
                        lastUserMessage.text,
                        undefined,
                        llmConfig.semanticMemoryMaxResults || 3,
                        llmConfig.semanticMemorySimilarityThreshold || 0.75
                    );
                    if (relevantMemories.length > 0) {
                        const truncated = retriever.truncateToTokenLimit(relevantMemories, 400);
                        const mergedMemory = truncated.map((m: any) => m.content).join('\n');
                        
                        // Inject into user message to preserve KV Cache (prevent systemPrompt changes)
                        updatedHistory[lastUserIndex] = {
                            ...lastUserMessage,
                            text: `<context>\nHere is some factual context about the user from past conversations. You MUST use this information to answer the user's query:\n${mergedMemory}\n</context>\n\n${lastUserMessage.text}`
                        };
                        logger.log('info', `GGUF: Injected ${truncated.length} semantic memories into user message`);
                    }
                }
            }
        } catch (error) {
            logger.log('warn', 'GGUF: Failed to retrieve semantic memories', error);
        }
    }

    // Add tool instructions if enabled
    if (isToolCallingEnabled(llmConfig)) {
        logger.log('info', '[LLM_CHAIN] Tool calling enabled. Injecting ReAct instructions...');
        // Use compact prompt for native-gguf to reduce token count significantly
        if (llmConfig.provider === 'native-gguf') {
            systemPrompt += "\n" + getReActSystemPromptCompact(llmConfig.toolRules);
        } else {
            systemPrompt += "\n" + getReActSystemPromptAddition(llmConfig.toolRules);
        }
    } else {
        logger.log('info', '[LLM_CHAIN] Tool calling disabled.');
    }

    // Add Chain-of-Thought prompting when thinking is enabled and tools are NOT enabled for GGUF models.
    // If tools ARE enabled, the tool prompt already includes thinking instructions.
    if (llmConfig.enableThinking && !isToolCallingEnabled(llmConfig)) {
        systemPrompt += `

IMPORTANT: Before answering, reason step-by-step. Show your thinking process enclosed in <thinking> and </thinking> tags.
Example:
<thinking>
Let's analyze the problem...
1. First I consider...
2. Then I evaluate...
3. Finally I conclude that...
</thinking>

Your final answer goes AFTER the thinking tags.`;
    }

    return { systemPrompt, updatedHistory };
}

export function truncateHistory(
    history: Message[],
    systemPrompt: string,
    llmConfig: LLMConfig,
    maxResponseLength?: number
): Message[] {
    // History Truncation Logic

    // Estimate context size, default to 2048 if not set
    // Reserve tokens for response
    const maxResponseTokens = maxResponseLength || 512;

    // Use shared smart truncation logic
    // This handles cases where systemPrompt itself > contextSize by truncating it
    // And efficiently fills the rest with history
    const truncationResult = refineContext(
        history,
        systemPrompt,
        llmConfig,
        maxResponseTokens
    );

    if (truncationResult.truncated) {
        logger.log('info', '[GGUF] Context truncation applied', {
            originalHistory: history.length,
            keptHistory: truncationResult.messages.length
        });
    }

    return truncationResult.messages;
}

/**
 * Enhanced truncation that returns both messages and potentially truncated system prompt.
 * Recommended replacement for `truncateHistory` in the future.
 */
export function smartContextRefinement(
    history: Message[],
    systemPrompt: string,
    llmConfig: LLMConfig,
    maxResponseLength?: number
): { messages: Message[], systemPrompt: string } {
    const { messages: refinedHistory, systemPrompt: refinedSystemPrompt } = refineContext(
        history,
        systemPrompt,
        llmConfig,
        maxResponseLength || 512
    );

    logger.log('info', `[LLM_CHAIN] Context refinement complete. Keeping ${refinedHistory.length} messages. New system prompt length: ${refinedSystemPrompt.length}`);

    return {
        messages: refinedHistory,
        systemPrompt: refinedSystemPrompt
    };
}
