import { Message, LLMConfig } from '../../../types';
import { logger } from '../../logger';
import { getEncoding } from 'js-tiktoken';

/**
 * Unified Context Manager for AI Mind Mesh
 * Standardizes token counting and truncation across all providers.
 */

// Initialize tokenizer encoding once
let tokenizer: any = null;
try {
    tokenizer = getEncoding('cl100k_base');
} catch (e) {
    logger.log('error', '[UnifiedContext] Failed to initialize tokenizer', e);
}

export const CHARS_PER_TOKEN = 3.0; // Fallback if tokenizer fails

export interface TruncationResult {
    systemPrompt: string;
    messages: Message[];
    truncated: boolean;
    estimate: {
        systemTokens: number;
        messageTokens: number;
        totalTokens: number;
    };
}

/**
 * Estimate token count for a string
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    if (tokenizer) {
        try {
            return tokenizer.encode(text).length;
        } catch (e) {
            // Fallback
        }
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Tiered Context Refinement
 * 1. Prunes older conversational history.
 * 2. Prunes non-essential sections of the system prompt (RAG context).
 * 3. Keeps core personality and instructions intact as much as possible.
 */
export function refineContext(
    history: Message[],
    systemPrompt: string,
    config: LLMConfig,
    maxResponseTokens: number = 512
): TruncationResult {
    const contextSize = config.nCtx || config.contextSize || 2048;
    const SAFETY_BUFFER = 100;

    // Calculate total allowed tokens for input
    const allowedInputTokens = contextSize - maxResponseTokens - SAFETY_BUFFER;

    let currentSystemPrompt = systemPrompt;
    let systemTokens = estimateTokens(currentSystemPrompt);
    let truncated = false;

    // --- Tier 1: System Prompt Truncation (RAG/Extra Context) ---
    // If system prompt alone is over 70% of budget, try to prune injected context
    if (systemTokens > allowedInputTokens * 0.7) {
        logger.log('info', `[UnifiedContext] System prompt is large (${systemTokens}). Attempting to prune non-essential parts.`);

        // Pattern for injected Workspace/Semantic context
        // We no longer strip LONG-TERM MEMORIES here, as user memories are critical to the persona
        // and usually very small compared to RAG context.
        const contextPatterns = [
            /## 📚 WORKSPACE CONTEXT[\s\S]*?(?=CURRENT CONTEXT:|CONVERSATION RULES:|$)/,
            /RELEVANT WORKSPACE DOCUMENTS:[\s\S]*?YOUR TASK:/
        ];

        for (const pattern of contextPatterns) {
            if (pattern.test(currentSystemPrompt)) {
                const originalLength = currentSystemPrompt.length;
                currentSystemPrompt = currentSystemPrompt.replace(pattern, (match) => {
                    // Truncate the match to its first 200 chars to signal presence but save space
                    return match.substring(0, 200) + "\n...[Context Heavily Truncated to save Memory]...\n";
                });

                if (currentSystemPrompt.length < originalLength) {
                    systemTokens = estimateTokens(currentSystemPrompt);
                    truncated = true;
                    // If we're now under the threshold, stop pruning
                    if (systemTokens <= allowedInputTokens * 0.5) break;
                }
            }
        }
    }

    // Hard limit on system prompt: if it's STILL over budget, we must hard truncate
    if (systemTokens > allowedInputTokens - 100) {
        logger.log('warn', `[UnifiedContext] System prompt STILL too large (${systemTokens}). Hard truncating.`);
        const maxSysChars = Math.floor((allowedInputTokens - 100) * CHARS_PER_TOKEN);
        currentSystemPrompt = currentSystemPrompt.substring(0, maxSysChars) + "\n...[Hard Truncated]...";
        systemTokens = estimateTokens(currentSystemPrompt);
        truncated = true;
    }

    // --- Tier 2: History Truncation ---
    const messageBudget = allowedInputTokens - systemTokens;
    const keptMessages: Message[] = [];
    let messageTokens = 0;

    // Filter out images for token counting if not vision capable (placeholder logic)
    // but typically we just count the text. 
    // Newest first
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const msgLen = estimateTokens(msg.text) + 10; // 10 for overhead

        if (messageTokens + msgLen <= messageBudget) {
            keptMessages.unshift(msg);
            messageTokens += msgLen;
        } else if (keptMessages.length === 0 && i === history.length - 1) {
            // Always keep at least the last message, even if we have to truncate it
            const allowedMsgChars = Math.floor(messageBudget * CHARS_PER_TOKEN);
            if (allowedMsgChars > 20) {
                keptMessages.unshift({
                    ...msg,
                    text: msg.text.substring(0, allowedMsgChars) + "...[Truncated]"
                });
                messageTokens += messageBudget;
                truncated = true;
            }
            break;
        } else {
            truncated = true;
            break;
        }
    }

    return {
        systemPrompt: currentSystemPrompt,
        messages: keptMessages,
        truncated,
        estimate: {
            systemTokens,
            messageTokens,
            totalTokens: systemTokens + messageTokens
        }
    };
}
