import { Message, LLMConfig } from '../../types';
import { logger } from '../logger';

/**
 * Constant for token estimation (same logic used in contextManager.ts)
 * Approximately 3.5 characters per token
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Result of context estimation
 */
export interface ContextUsageEstimate {
    tokensUsed: number;
    totalTokens: number;
    usagePercent: number;
}

/**
 * Estimates context usage based on messages, system prompt, and configured size
 * 
 * @param messages Array of conversation messages
 * @param systemPrompt System prompt (can be empty for rough estimates)
 * @param contextSize Configured context window size (e.g., 2048)
 * @returns Object with tokens used, total tokens, and usage percentage
 */
export function estimateContextUsage(
    messages: Message[],
    systemPrompt: string,
    contextSize: number
): ContextUsageEstimate {
    // Calculate system prompt tokens
    const systemPromptTokens = Math.ceil(systemPrompt.length / CHARS_PER_TOKEN);

    // Calculate message tokens
    let messagesTokens = 0;
    for (const msg of messages) {
        // Count message text + overhead for tags/roles (~10 tokens)
        const msgTokens = Math.ceil(msg.text.length / CHARS_PER_TOKEN) + 10;
        messagesTokens += msgTokens;

        // If there are images, add overhead (estimated)
        if (msg.images && msg.images.length > 0) {
            messagesTokens += msg.images.length * 50; // ~50 tokens per image
        }

        // If there are files, add their content
        if (msg.files && msg.files.length > 0) {
            for (const file of msg.files) {
                messagesTokens += Math.ceil(file.content.length / CHARS_PER_TOKEN);
            }
        }
    }

    const tokensUsed = systemPromptTokens + messagesTokens;
    const usagePercent = tokensUsed / contextSize;

    return {
        tokensUsed,
        totalTokens: contextSize,
        usagePercent
    };
}

/**
 * Determines if summarization is necessary
 * 
 * @param messages Array of messages
 * @param llmConfig LLM Configuration
 * @param threshold Percentage threshold (e.g., 0.5 for 50%)
 * @returns true if summarization should be performed
 */
export function shouldSummarize(
    messages: Message[],
    llmConfig: LLMConfig,
    threshold: number
): boolean {
    // Do not summarize if there are too few messages
    if (messages.length < 10) {
        return false;
    }

    const contextSize = llmConfig.nCtx || llmConfig.contextSize || 2048;
    const estimate = estimateContextUsage(messages, '', contextSize);

    const shouldDo = estimate.usagePercent >= threshold;

    if (shouldDo) {
        logger.log('info', '[ContextMonitor] Summarization recommended', {
            usagePercent: Math.round(estimate.usagePercent * 100),
            threshold: Math.round(threshold * 100),
            messageCount: messages.length,
            tokensUsed: estimate.tokensUsed,
            totalTokens: estimate.totalTokens
        });
    }

    return shouldDo;
}

/**
 * Identifies which messages to summarize and which to keep
 * 
 * @param messages Complete array of messages
 * @param threshold Summarization threshold (e.g., 0.5 = 50%)
 * @returns Object with messages to summarize and messages to keep
 */
export function getMessagesToSummarize(
    messages: Message[],
    threshold: number
): { toSummarize: Message[]; toKeep: Message[] } {
    // Calculate how many messages to keep
    // If threshold is 50%, we want to summarize ~40% and keep ~60%
    // If threshold is 30%, we want to summarize ~20% and keep ~80%
    // If threshold is 70%, we want to summarize ~60% and keep ~40%

    // Formula: keep (1 - threshold + 0.1) of messages
    const keepRatio = Math.min(1 - threshold + 0.1, 0.8); // Max 80% kept
    const keepCount = Math.max(
        Math.floor(messages.length * keepRatio),
        5 // Keep at least 5 messages
    );

    const summarizeCount = messages.length - keepCount;

    // Do not summarize existing summary messages
    const toSummarize = messages.slice(0, summarizeCount).filter(m => !m.isSummary);
    const toKeep = messages.slice(summarizeCount);

    logger.log('info', '[ContextMonitor] Split messages for summarization', {
        total: messages.length,
        toSummarize: toSummarize.length,
        toKeep: toKeep.length,
        threshold: Math.round(threshold * 100)
    });

    return { toSummarize, toKeep };
}
