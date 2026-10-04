import { Message, LLMConfig, Personality } from '../../../../types';
import { logger } from '../../../logger';
import { buildPromptContext, historyWithTurnContext } from '../../promptContext';
import { getReActSystemPromptAddition, getReActSystemPromptCompact } from '../../../toolDefinitions';
import { refineContext } from '../../context/unifiedContextManager';
import { withLanguageRule } from '../../prompt/onDevicePrompt';
import { PROMPT_TEXTS } from '../../prompt/promptTexts';
import { routedTools } from '../../background/taskFlags';

// Helper to check if tool calling is enabled
const isToolCallingEnabled = (llmConfig: LLMConfig): boolean => {
    return llmConfig.enableToolCalling === true;
};

export async function prepareContext(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    answerTokens?: number,
    /** Gemma 4 / Qwen 3 with a template that renders tools and reasoning: no ReAct, no <thinking> instruction */
    native: { tools?: boolean; thinking?: boolean } = {}
): Promise<{ systemPrompt: string; updatedHistory: Message[]; }> {
    // Persona and the user profile in the system prompt; related memories and workspace documents
    // go into the user turn, so the system prompt (and the KV cache) stays stable. The answer
    // tokens become a length rule in the assistant's language.
    const promptContext = await buildPromptContext({
        personality, llmConfig, history, answerTokens,
        onDevice: true, // compact prompt in the assistant's language
    });
    let systemPrompt = promptContext.systemPrompt;
    const updatedHistory = historyWithTurnContext(history, promptContext);
    logger.log('info', `[LLM_CHAIN] Base system prompt built. Length: ${systemPrompt.length}`);

    const language = promptContext.language ?? 'it';
    if (native.tools) {
        // The template declares the tools; the model gets the rules for using them
        systemPrompt += '\n\n' + PROMPT_TEXTS[language].toolRules.map(r => `- ${r}`).join('\n');
    } else if (isToolCallingEnabled(llmConfig)) {
        logger.log('info', '[LLM_CHAIN] Tool calling enabled. Injecting ReAct instructions...');
        // Use compact prompt for native-gguf to reduce token count significantly
        if (llmConfig.provider === 'native-gguf') {
            systemPrompt += "\n" + getReActSystemPromptCompact(llmConfig.toolRules, routedTools(llmConfig));
        } else {
            systemPrompt += "\n" + getReActSystemPromptAddition(llmConfig.toolRules);
        }
    } else {
        logger.log('info', '[LLM_CHAIN] Tool calling disabled.');
    }

    // Add Chain-of-Thought prompting when thinking is enabled and tools are NOT enabled for GGUF models.
    // If tools ARE enabled, the tool prompt already includes thinking instructions.
    if (llmConfig.enableThinking && !isToolCallingEnabled(llmConfig) && !native.thinking) {
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

    systemPrompt = withLanguageRule(systemPrompt, language);
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
    maxResponseLength?: number,
    contextWindow?: number
): { messages: Message[], systemPrompt: string } {
    const { messages: refinedHistory, systemPrompt: refinedSystemPrompt } = refineContext(
        history,
        systemPrompt,
        llmConfig,
        maxResponseLength || 512,
        contextWindow
    );

    logger.log('info', `[LLM_CHAIN] Context refinement complete. Keeping ${refinedHistory.length} messages. New system prompt length: ${refinedSystemPrompt.length}`);

    return {
        messages: refinedHistory,
        systemPrompt: refinedSystemPrompt
    };
}
