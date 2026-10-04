import { Message, LLMConfig } from '../../../types';
import { logger } from '../../logger';
import { getEncoding } from 'js-tiktoken';
import { onDeviceContextSize } from './contextSize';

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
 * Tokens kept free for the answer. Never more than half the window: a response style
 * larger than the context (e.g. 4000 on a 2048 model) would otherwise leave no room for input.
 */
/** Tokens on-device models get to reason (<thinking>) before the answer when no thinking budget is set */
export const DEFAULT_REASONING_TOKENS = 512;

/**
 * Answer tokens plus room for the reasoning the prompt asks for (thinking mode, or the ReAct
 * <thinking> steps of tool calling): with Atlas's 250 tokens the reasoning used them all and the
 * answer never came (Fold7, Gemma 4 E4B).
 */
export function withReasoningAllowance(answerTokens: number, config: { enableThinking?: boolean; enableToolCalling?: boolean; thinkingBudget?: number }): number {
    if (!config.enableThinking && !config.enableToolCalling) return answerTokens;
    return answerTokens + (config.thinkingBudget && config.thinkingBudget > 0 ? config.thinkingBudget : DEFAULT_REASONING_TOKENS);
}

export function getResponseReserve(contextSize: number, maxResponseTokens: number): number {
    return Math.max(64, Math.min(maxResponseTokens, Math.floor(contextSize / 2)));
}

/** Input windows of the remote providers (tokens). nCtx/contextSize describe on-device models only. */
const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
    gemini: 1_000_000,
    claude: 200_000,
    perplexity: 127_000,
    openrouter: 32_000,
    'aimindmesh-server': 32_000,
    local: 8_192,
};

export function getProviderContextWindow(provider: string): number | undefined {
    return PROVIDER_CONTEXT_WINDOWS[provider];
}

/**
 * Tiered Context Refinement
 * 1. Prunes older conversational history.
 * 2. Prunes non-essential sections of the system prompt (RAG context).
 * 3. Keeps core personality and instructions intact as much as possible.
 * The last message is always kept (truncated if needed): an empty history breaks every provider.
 */
export function refineContext(
    history: Message[],
    systemPrompt: string,
    config: LLMConfig,
    maxResponseTokens: number = 512,
    contextWindow?: number
): TruncationResult {
    const contextSize = contextWindow || onDeviceContextSize(config);
    const SAFETY_BUFFER = 100;

    // Calculate total allowed tokens for input
    const allowedInputTokens = contextSize - getResponseReserve(contextSize, maxResponseTokens) - SAFETY_BUFFER;

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

    // Hard limit on system prompt: if it's STILL over budget, the middle goes (the profile); the
    // persona at the start and the rules, tools and language rule at the end stay
    if (systemTokens > allowedInputTokens - 100) {
        logger.log('warn', `[UnifiedContext] System prompt STILL too large (${systemTokens}). Cutting its middle.`);
        currentSystemPrompt = cutMiddle(currentSystemPrompt, Math.floor((allowedInputTokens - 100) * CHARS_PER_TOKEN));
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
            // Always keep at least the last message: its memory context shrinks first, the
            // request itself is cut only when it alone is too long
            const allowedMsgChars = Math.max(200, Math.floor(messageBudget * CHARS_PER_TOKEN));
            keptMessages.unshift({ ...msg, text: fitTurnText(msg.text, allowedMsgChars) });
            messageTokens += Math.max(0, messageBudget);
            truncated = true;
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

const CUT_MARK = '\n…\n';

/** Keeps the first quarter and the end of a text within maxChars (the end holds the rules) */
export function cutMiddle(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const room = Math.max(0, maxChars - CUT_MARK.length);
    const head = Math.floor(room / 4);
    return text.slice(0, head) + CUT_MARK + text.slice(text.length - (room - head));
}

const TURN_CONTEXT = /^<context>\n([\s\S]*?)\n<\/context>\n\n/;

/**
 * A user turn within maxChars: the <context> block the on-device engines prepend (facts,
 * memories, documents) is cut first, keeping its intro and its last paragraph (the recall
 * instruction); then the request, from its end.
 */
export function fitTurnText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const m = TURN_CONTEXT.exec(text);
    const request = m ? text.slice(m[0].length) : text;
    if (!m || request.length + 80 >= maxChars) {
        return request.substring(0, Math.max(0, maxChars - 15)) + '...[Truncated]';
    }
    const body = m[1];
    const room = maxChars - request.length - '<context>\n\n</context>\n\n'.length;
    const lastBreak = body.lastIndexOf('\n\n');
    const tail = lastBreak > 0 && body.length - lastBreak < room / 2 ? body.slice(lastBreak) : '';
    const head = body.slice(0, Math.max(0, room - tail.length - CUT_MARK.length));
    return `<context>\n${head}${tail ? CUT_MARK.trimEnd() + tail : ''}\n</context>\n\n${request}`;
}
