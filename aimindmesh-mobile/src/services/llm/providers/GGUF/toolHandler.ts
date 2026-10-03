import { LLMConfig, Message } from '../../../../types';
import { logger } from '../../../logger';
import { getFormattedToolDefinitions } from '../../../toolDefinitions';
import { ToolCall, parseReActToolCalls } from '../../../tools';
import * as nativeLLM from '../../nativeLLM';
import { estimateTokens } from '../../context/unifiedContextManager';
import { toChatRole } from '../../roles';

export const isToolCallingEnabled = (llmConfig: LLMConfig): boolean => {
    return llmConfig.enableToolCalling === true;
};

// Helper to check if a dedicated tool-use model is configured
export const hasDedicatedToolModel = (llmConfig: LLMConfig): boolean => {
    return !!(llmConfig.toolUseModelPath &&
        llmConfig.toolUseModelPath !== llmConfig.nativeModelPath);
};

/**
 * Generate a concise context summary using the main chat model.
 * This ensures we stay within the tool model's context limit (usually 2048).
 */
async function getRelevantContextSummary(
    history: Message[],
    assistantPlan: string,
    slot: nativeLLM.ModelSlot = 'chat'
): Promise<string> {
    logger.log('info', '[ToolHandler] 📝 Requesting intelligent context summary from main model...');

    // We don't use the full history here to avoid an infinite loop or excessive tokens
    // but the main model already has the full history loaded in its KV cache if appendMode was used.
    // We send a targeted system instruction to extract the "essence" of the request.
    const summaryInstruction = `Based on our conversation, provide a VERY BRIEF summary (max 2 sentences) of the specific user request and any critical parameters (filenames, paths, IDs, previous choices) needed to execute this plan: "${assistantPlan}".`;

    try {
        let summary = '';
        // We use the 'chat' slot because it already has the KV cache warm.
        // Chat-template messages ({role, content}): app Messages carry `text` and role 'model'.
        // The instruction is the final user turn (templates reject a system role after the start).
        const messages = [
            ...history.slice(-10).map(m => ({ role: toChatRole(m.role), content: m.text })),
            { role: 'user', content: summaryInstruction }
        ];

        for await (const chunk of nativeLLM.generateNativeStream({
            messages,
            temperature: 0.1,
            maxTokens: 150,
            stop: ['<end_of_turn>', '<|im_end|>']
        }, slot)) {
            summary += chunk;
        }

        const trimmedSummary = summary.trim();
        logger.log('info', '[ToolHandler] ✅ Context summary generated', { length: trimmedSummary.length });
        return trimmedSummary;
    } catch (error) {
        logger.log('error', '[ToolHandler] Failed to generate context summary', error);
        return history[history.length - 1]?.text || 'User request unknown';
    }
}

/**
 * Extract tool calls using a dedicated tool-use model (e.g., FunctionGemma)
 */
export async function extractToolCallsWithDedicatedModel(
    conversationText: string,
    lastUserMessage: string,
    llmConfig: LLMConfig,
    history: Message[] = []
): Promise<ToolCall[]> {
    if (!llmConfig.toolUseModelPath) {
        return [];
    }

    try {
        // Tool model should already be loaded in 'tool' slot
        const toolModelInfo = nativeLLM.getSlotModelInfo('tool');

        if (!toolModelInfo.isLoaded) {
            logger.log('warn', 'Tool model not loaded, loading now...');
            await nativeLLM.initNativeModel({
                modelPath: llmConfig.toolUseModelPath,
                nThreads: llmConfig.nThreads,
                nCtx: 2048, // Hard limit for extraction models usually
                nBatch: 32, // Prevent GPU ANR during long prompt evaluation
                nUBatch: 32
            }, 'tool');
        }

        // --- Context Intelligent Management ---
        const TOOL_MODEL_LIMIT = 2048;
        const SAFETY_BUFFER = 256; // Leave space for output
        const MAX_PROMPT_TOKENS = TOOL_MODEL_LIMIT - SAFETY_BUFFER;

        let contextToUse = lastUserMessage;
        const toolDefs = getFormattedToolDefinitions(llmConfig.toolRules);
        
        // Estimate token count of the final prompt
        const baseSystemTokens = 200; // translator instructions
        const totalEstimated = estimateTokens(toolDefs) + estimateTokens(lastUserMessage) + estimateTokens(conversationText) + baseSystemTokens;

        if (totalEstimated > MAX_PROMPT_TOKENS) {
            logger.log('warn', '[ToolHandler] ⚠️ Tool extraction prompt too large for limit', {
                estimated: totalEstimated,
                limit: TOOL_MODEL_LIMIT
            });

            // Use the main model to summarize context
            const chatSlot = (llmConfig as any).useMemorySlot ? 'memory' : 'chat';
            contextToUse = await getRelevantContextSummary(history, conversationText, chatSlot);
            
            // Final safety check: if even the summary is somehow too big, hard truncate
            if (estimateTokens(contextToUse) > 1000) {
                contextToUse = contextToUse.substring(0, 3000) + "...[Truncated]";
            }
        }

        // --- Prompt Construction ---
        // Detect model type from path for prompt formatting
        const modelPath = llmConfig.toolUseModelPath?.toLowerCase() || '';
        const isGemma = modelPath.includes('gemma');
        const isQAT = modelPath.includes('qat');

        if (isQAT) {
            logger.log('info', '[ToolHandler] 🧠 Quantization-Aware Training (QAT) model detected. Using optimized extraction prompt.');
        }

        let toolExtractionPrompt = '';
        let stopTokens = ['<|im_end|>', '<|im_start|>'];

        const systemInst = `You are a command translator.
Your task is to convert the Assistant's plan into the correct tool call using the XML format.

Context: ${contextToUse}

Available Tools:
${toolDefs}

Rules:
1. Analyze the "Plan" below.
2. Select the most appropriate tool from the list.
3. Output the tool call using this format: <tool>tool_name({"param": "value"})</tool>
4. Return ONLY the XML tag. Nothing else.
5. If no tool is needed, return NO_TOOLS.

Examples:
Plan: "I will check the files in the current directory."
Output: <tool>run_termux_command({"command": "ls -la"})</tool>

Plan: "I'll create a reminder to buy milk."
Output: <tool>create_calendar_event({"title": "Buy milk", "date": "2024-01-01", "time": "10:00"})</tool>

Plan: "I'm sorry, I cannot do that."
Output: NO_TOOLS`;

        const userContent = `Plan: "${conversationText}"

Output Tool Call:`;

        if (isGemma) {
            // Gemma format (optimized for QAT models - no trailing spaces before end_of_turn)
            toolExtractionPrompt = `<start_of_turn>user\n${systemInst}\n\n${userContent}<end_of_turn>\n<start_of_turn>model\n`;
            stopTokens = ['<end_of_turn>', '<start_function_call>'];
        } else {
            // ChatML format (default)
            toolExtractionPrompt = `<|im_start|>system
${systemInst}
<|im_end|>
<|im_start|>user
${userContent}
<|im_end|>
<|im_start|>assistant
`;
        }

        let toolModelOutput = '';
        // Use the 'tool' slot
        for await (const chunk of nativeLLM.generateNativeStream({
            prompt: toolExtractionPrompt,
            temperature: 0.0,
            topP: 1.0,
            maxTokens: 200,
            stop: stopTokens
        }, 'tool')) {
            toolModelOutput += chunk;
        }

        logger.log('debug', 'Tool model output', { output: toolModelOutput });

        // Parse tool calls from the output
        const { calls } = parseReActToolCalls(toolModelOutput);
        return calls;
    } catch (error: any) {
        logger.log('error', 'Failed to extract tool calls with dedicated model', error);
        // Fallback to parsing from original text
        const { calls } = parseReActToolCalls(conversationText);
        return calls;
    }
}
