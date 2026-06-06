/**
 * Token counting and truncation utilities for LLM providers.
 * Provides a unified way to estimate token usage and enforce context limits.
 */

import { Message } from '../../types';
import { logger } from '../logger';

/**
 * Average characters per token based on empirical testing with Llama-3/Phi-3.
 * Using 3.0 instead of 3.5 to avoid context overflows.
 */
export const CHARS_PER_TOKEN = 3.0;

/**
 * Estimate the number of tokens in a string.
 */
export function estimateTokenCount(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the number of tokens in a message object, including overhead.
 */
export function estimateMessageTokens(message: Message): number {
    // text length + overhead for role tags, etc.
    return estimateTokenCount(message.text) + 10;
}

/**
 * Smartly truncate a prompt to fit within the context window.
 * 
 * Strategy:
 * 1. Calculate budget: contextSize - maxResponseTokens - overhead.
 * 2. Check if System Prompt fits. If not, truncate the system prompt (preserving start/end instructions if possible, but aggressively cutting context).
 * 3. Fill remaining budget with history messages (newest first).
 * 
 * @param history Full conversation history
 * @param systemPrompt The system prompt (including any injected context)
 * @param contextSize The model's context window size (e.g., 2048)
 * @param maxResponseTokens Reserved tokens for the model's response
 * @param numImages Number of images in history to account for overhead
 * @returns Object containing the truncated system prompt and the subset of history messages to use.
 */
export function smartTruncate(
    history: Message[],
    systemPrompt: string,
    contextSize: number = 2048,
    maxResponseTokens: number = 512,
    numImages: number = 0
): { systemPrompt: string, messages: Message[], truncated: boolean } {

    // Safety buffer to avoid hitting exact limits
    const SAFETY_BUFFER = 100;

    // Image Token Overhead (LAVA/CLIP models typically use 576-1024 tokens per image)
    const TOKENS_PER_IMAGE = 600;
    const imageOverhead = numImages * TOKENS_PER_IMAGE;

    // 1. Calculate Total Budget
    let availableTokens = contextSize - maxResponseTokens - SAFETY_BUFFER - imageOverhead;

    // Ensure we have at least a minimum working space
    if (availableTokens < 200) {
        logger.log('warn', `[TokenUtils] Very low context budget (${availableTokens}). Forcing minimum 200.`);
        availableTokens = 200;
    }

    let truncated = false;
    let finalSystemPrompt = systemPrompt;
    let systemPromptTokens = estimateTokenCount(systemPrompt);

    // 2. Check System Prompt
    // If system prompt takes up more than 60% of available tokens, we might need to trim it 
    // to leave room for at least some history.
    // However, if the system prompt ITSELF > availableTokens, we MUST truncate it.

    if (systemPromptTokens > availableTokens) {
        logger.log('warn', `[TokenUtils] System prompt too large (${systemPromptTokens} > ${availableTokens}). Truncating.`);

        // Truncate system prompt to 80% of available tokens to leave a tiny bit for user message
        const targetSysPromptTokens = Math.floor(availableTokens * 0.8);
        const targetChars = Math.floor(targetSysPromptTokens * CHARS_PER_TOKEN);

        // Simple truncation for now: Keep the first X chars. 
        // Ideally we'd keep instructions (start) and cut the middle (context), 
        // but finding the split point reliably is hard without clear markers.
        // We'll just take the first N characters as the most important instructions are usually at the top.
        // If the system prompt has "Constraint" at the end, this might be risky, but better than crashing.
        finalSystemPrompt = systemPrompt.substring(0, targetChars) + "\n...[Truncated Context]...";
        systemPromptTokens = estimateTokenCount(finalSystemPrompt);
        truncated = true;
    }

    // 3. Fill with History
    // Remaining budget for messages
    let messageBudget = availableTokens - systemPromptTokens;

    // Ensure accurate user message always gets in if possible?
    // We should always try to include the LAST message (User query).
    // If budget is still negative (shouldn't be, due to step 2 logic), we force it.
    if (messageBudget < 50) messageBudget = 50;

    const messagesToUse: Message[] = [];
    let currentMessageTokens = 0;

    // Reserve tokens for the oldest message (the original user query) to ensure context isn't completely lost
    // Only reserve if we have multiple messages in history
    const reservedTokensForOldest = history.length > 1 ? 200 : 0;

    // Adjusted budget for the new messages
    let adjustedBudget = messageBudget - reservedTokensForOldest;

    // Iterate backwards (Newest -> Oldest)
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        let msgTokens = estimateMessageTokens(msg);

        // If this is the absolute oldest message, we add back the reserved tokens to the budget
        if (i === 0 && history.length > 1) {
            adjustedBudget += reservedTokensForOldest;
        }

        if (currentMessageTokens + msgTokens <= adjustedBudget) {
            messagesToUse.unshift(msg);
            currentMessageTokens += msgTokens;
        } else {
            // Cannot fit the full message
            truncated = true;

            // Calculate how much space is left for this message
            const remainingSpace = adjustedBudget - currentMessageTokens;

            if (remainingSpace > 50) {
                // If we have enough space to fit a meaningful chunk, we truncate the message
                logger.log('warn', `[TokenUtils] Message at index ${i} too large (${msgTokens} > ${remainingSpace}). Truncating message.`);
                const permittedChars = Math.floor(remainingSpace * CHARS_PER_TOKEN);

                // For Observations, keep the beginning (so model sees "Observation: ")
                // For other messages, we might want different strategies, but starting from 0 is safest
                const truncatedText = msg.text.substring(0, permittedChars) + "\n...[Truncated]";

                const truncatedMsg = {
                    ...msg,
                    text: truncatedText
                };
                messagesToUse.unshift(truncatedMsg);

                // Now the budget is essentially full
                currentMessageTokens += remainingSpace;
            } else {
                logger.log('warn', `[TokenUtils] Skipping message at index ${i} entirely due to tight budget (remaining: ${remainingSpace}).`);
                // Don't break! Continue to the next older message. 
                // It might be small enough to fit in the reserved space (like the original user query)
            }
        }
    }

    if (truncated) {
        logger.log('info', `[TokenUtils] Smart truncation active. System: ${systemPromptTokens}, Msgs: ${messagesToUse.length}, Budget: ${availableTokens}`);
    }

    return {
        systemPrompt: finalSystemPrompt,
        messages: messagesToUse,
        truncated
    };
}
