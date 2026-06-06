import { Message, Personality, Memory, LLMConfig } from '../../types';
import { logger } from '../logger';
import { buildSystemPrompt } from './promptBuilder';
import { StreamChunk } from './llmService';
import { getReActSystemPromptCompact } from '../toolDefinitions';
import { parseReActToolCalls } from '../tools';
import { createThinkingParser } from './thinkingParser';

/**
 * Generates a streaming response from Anthropic (Claude) API with tool and thinking support
 */
export async function* generateClaudeStream(
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
        throw new Error("Claude API key is missing");
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
                        logger.log('info', `Claude: Injected ${truncated.length} semantic memories into context`);
                    }
                }
            }
        } catch (error) {
            logger.log('warn', 'Claude: Failed to retrieve semantic memories', error);
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

    // Anthropic expects system prompt as a top-level parameter, not in messages
    const messages = history.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.text
    }));

    logger.log('info', 'Starting Claude stream', { model, toolsEnabled: llmConfig?.enableToolCalling, thinkingEnabled: llmConfig?.enableThinking });

    // Initialize thinking parser
    const thinkingParser = createThinkingParser();
    let fullGeneratedText = '';

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerously-allow-browser': 'true' // Necessary for client-side usage
            },
            body: JSON.stringify({
                model: model || 'claude-3-5-sonnet-latest',
                messages: messages,
                system: systemPrompt,
                stream: true,
                max_tokens: maxTokens || 1024,
                temperature: personality.llmParams?.temperature ?? 0.7,
            }),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.log('error', 'Claude API error', { status: response.status, body: errorText });
            throw new Error(`Claude API Error: ${response.status} ${response.statusText}`);
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
            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;
                if (line.startsWith('event: ')) continue; // Skip event name lines

                if (line.startsWith('data: ')) {
                    if (line.includes('[DONE]')) break;

                    try {
                        const data = JSON.parse(line.slice(6));

                        // Handle different event types
                        if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
                            const content = data.delta.text;
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
                        // It's common to get incomplete JSON in streams, just ignore unless it persists
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
                logger.log('debug', '[Claude] Found tool calls:', calls);
                for (const call of calls) {
                    yield { type: 'function_call', call };
                }
            }
        }

    } catch (error) {
        if (signal?.aborted) {
            logger.log('info', 'Claude request aborted');
            return;
        }
        logger.log('error', 'Claude stream failed', error);
        throw error;
    }
}
