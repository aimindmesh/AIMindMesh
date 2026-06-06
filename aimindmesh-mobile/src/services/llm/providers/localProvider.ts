import { Message, Personality, LLMConfig, Memory } from "../../../types";
import { logger } from "../../logger";
import { buildSystemPrompt } from "../promptBuilder";

/**
 * Provider for local LLM servers (like Ollama or local web servers)
 */
export async function* generateLocalStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories?: Memory[],
    signal?: AbortSignal,
    maxResponseLength?: number
) {
    let systemPrompt = buildSystemPrompt(personality, memories);

    // Inject Workspace Documents Context
    try {
        const { contextInjector } = await import('../contextInjector');
        const userMessage = history[history.length - 1];
        systemPrompt = await contextInjector.buildSystemPromptWithContext(userMessage.text, systemPrompt);
    } catch (e) {
        logger.log('warn', 'Failed to inject workspace context', e);
    }
    const messagesPayload = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.text }))
    ];

    logger.log('info', 'Connecting to local stream', { endpoint: llmConfig.localEndpoint, model: llmConfig.localModel });
    const response = await fetch(`${llmConfig.localEndpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: llmConfig.localModel,
            messages: messagesPayload,
            stream: true,
            max_tokens: maxResponseLength || 1000,
        }),
        signal // Pass signal to fetch for network-level cancellation
    });

    if (!response.ok || !response.body) {
        logger.log('error', 'Failed to connect to local server', { status: response.status, statusText: response.statusText });
        throw new Error(`Failed to connect to local server: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            // Check if generation was aborted
            if (signal?.aborted) {
                logger.log('info', 'Local stream generation was aborted by user');
                await reader.cancel();
                throw new DOMException('Generation aborted by user', 'AbortError');
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6).trim();
                    if (dataStr === '[DONE]') continue;
                    try {
                        const data = JSON.parse(dataStr);
                        const delta = data.choices?.[0]?.delta?.content;
                        if (delta) {
                            yield delta;
                        }
                    } catch (e) {
                        logger.log('warn', 'Error parsing local stream data chunk', e);
                    }
                }
            }
        }
    } finally {
        // Ensure reader is always released
        reader.releaseLock();
    }
}
