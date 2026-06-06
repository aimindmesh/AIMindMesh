import { Message, Personality, Memory, LLMConfig } from '../../types';
import { logger } from '../logger';
import { buildSystemPrompt } from './promptBuilder';
import { StreamChunk } from './llmService';
import { getReActSystemPromptCompact } from '../toolDefinitions';
import { parseReActToolCalls } from '../tools';
import { createThinkingParser } from './thinkingParser';

/**
 * Generates a streaming response from Perplexity API with tool and thinking support
 */
export async function* generatePerplexityStream(
    history: Message[],
    personality: Personality,
    model: string,
    apiKey: string,
    memories?: Memory[],
    signal?: AbortSignal,
    maxTokens?: number,
    llmConfig?: LLMConfig
): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
        throw new Error("Perplexity API key is missing");
    }

    // 1. Validate and sanitize model
    const validModels = ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'];
    let selectedModel = model;
    if (!validModels.includes(selectedModel)) {
        logger.log('warn', `Invalid or deprecated Perplexity model '${selectedModel}', falling back to 'sonar-pro'`, { validModels });
        selectedModel = 'sonar-pro';
    }

    // Prepare system prompt with semantic memory support
    let systemPrompt = buildSystemPrompt(personality, llmConfig?.enableSemanticMemory ? undefined : memories);

    // Retrieve semantically relevant memories if enabled
    if (llmConfig?.enableSemanticMemory && llmConfig.embeddingModelId && history.length > 0) {
        try {
            const { getOrInitializeSemanticMemoryRetriever } = await import('../memory/semanticMemoryRetriever');
            const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
            if (retriever) {
                const lastUserMessage = [...history].reverse().find(m => m.role === 'user');
                if (lastUserMessage) {
                    const relevantMemories = await retriever.retrieveRelevantMemories(
                        lastUserMessage.text,
                        undefined,
                        llmConfig.semanticMemoryMaxResults || 3,
                        llmConfig.semanticMemorySimilarityThreshold || 0.75
                    );
                    if (relevantMemories.length > 0) {
                        const truncated = retriever.truncateToTokenLimit(relevantMemories, 400);
                        const semanticContext = retriever.formatForContext(truncated);
                        systemPrompt += '\n\n' + semanticContext;
                        logger.log('info', `Perplexity: Injected ${truncated.length} semantic memories into context`);
                    }
                }
            }
        } catch (error) {
            logger.log('warn', 'Perplexity: Failed to retrieve semantic memories', error);
        }
    }

    // Add tool instructions if enabled
    if (llmConfig?.enableToolCalling) {
        systemPrompt += "\n" + getReActSystemPromptCompact(llmConfig.toolRules);
    }

    // Add Chain-of-Thought prompting when thinking is enabled
    if (llmConfig?.enableThinking) {
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

    // 2. Prepare and sanitize messages (Strict Alternating Roles)
    let sanitizedMessages: { role: string; content: string }[] = [];

    // Add system prompt first if present
    if (systemPrompt) {
        sanitizedMessages.push({ role: 'system', content: systemPrompt });
    }

    // Map history to API format
    const historyMessages = history.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.text
    }));

    // Merge consecutive messages of the same role
    for (const msg of historyMessages) {
        if (sanitizedMessages.length > 0) {
            const lastMsg = sanitizedMessages[sanitizedMessages.length - 1];
            if (lastMsg.role === msg.role) {
                // Determine separator based on role (optional polish)
                lastMsg.content += `\n\n${msg.content}`;
                continue;
            }
        }
        sanitizedMessages.push(msg);
    }

    // Ensure the first non-system message is 'user'
    const firstNonSystemIndex = sanitizedMessages.findIndex(m => m.role !== 'system');
    if (firstNonSystemIndex !== -1 && sanitizedMessages[firstNonSystemIndex].role !== 'user') {
        sanitizedMessages.splice(firstNonSystemIndex, 0, { role: 'user', content: "(Conversation context)" });
    }

    // Ensure we have at least one user message
    if (sanitizedMessages.filter(m => m.role === 'user').length === 0) {
        sanitizedMessages.push({ role: 'user', content: "Hello" });
    }

    logger.log('info', 'Starting Perplexity stream', { model: selectedModel, toolsEnabled: llmConfig?.enableToolCalling, thinkingEnabled: llmConfig?.enableThinking });

    // Initialize thinking parser
    const thinkingParser = createThinkingParser();
    let fullGeneratedText = '';

    try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: sanitizedMessages,
                stream: true,
                max_tokens: maxTokens || 4096,
                temperature: Math.max(0.1, Math.min(1.9, personality.llmParams?.temperature ?? 0.7)),
                top_p: Math.max(0.1, Math.min(0.99, personality.llmParams?.topP ?? 0.9)),
            }),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.log('error', 'Perplexity API error', { status: response.status, body: errorText });
            throw new Error(`Perplexity API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.trim() === 'data: [DONE]') break;

                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                            const content = data.choices[0].delta.content;
                            fullGeneratedText += content;

                            // Use thinking parser if thinking is enabled
                            if (llmConfig?.enableThinking) {
                                for (const parsedChunk of thinkingParser.processChunk(content)) {
                                    yield parsedChunk;
                                }
                            } else {
                                yield { type: 'text', content };
                            }
                        }
                    } catch (e) {
                        logger.log('warn', 'Error parsing Perplexity chunk', e);
                    }
                }
            }
        }

        // Flush any remaining thinking buffer
        if (llmConfig?.enableThinking) {
            for (const parsedChunk of thinkingParser.flush()) {
                yield parsedChunk;
            }
        }

        // Parse tool calls if tool calling is enabled
        if (llmConfig?.enableToolCalling) {
            const { calls } = parseReActToolCalls(fullGeneratedText);
            if (calls.length > 0) {
                logger.log('debug', '[Perplexity] Found tool calls:', calls);
                for (const call of calls) {
                    yield { type: 'function_call', call };
                }
            }
        }

    } catch (error) {
        if (signal?.aborted) {
            logger.log('info', 'Perplexity request aborted');
            return;
        }
        logger.log('error', 'Perplexity stream failed', error);
        throw error;
    }
}
