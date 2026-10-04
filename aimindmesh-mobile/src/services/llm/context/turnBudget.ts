/**
 * Token budget of one on-device turn, shared by the context trimming and the generation: the
 * answer (the persona's limit, else the response style), the reasoning the prompt asks for, and
 * the rest of the window for the prompt. Computed once, so the prompt the trimming kept and the
 * tokens the engine may generate always fit together (the GGUF engine reserved the answer
 * without the reasoning, then generated with it).
 */
import type { LLMConfig, Personality } from '../../../types';
import { getResponseReserve, withReasoningAllowance } from './unifiedContextManager';

export interface TurnBudget {
    /** Context window of the engine */
    context: number;
    /** Tokens for the answer itself (drives the length hint of the prompt) */
    answer: number;
    /** Answer plus reasoning: what the trimming keeps free */
    requested: number;
    /** Generation cap, never more than half of the window */
    maxTokens: number;
}

export function budgetFor(config: LLMConfig, personality: Personality, maxResponseLength: number | undefined, context: number): TurnBudget {
    const answer = personality.llmParams?.maxTokens ?? (maxResponseLength || 1000);
    const requested = withReasoningAllowance(answer, config);
    return { context, answer, requested, maxTokens: getResponseReserve(context, requested) };
}
