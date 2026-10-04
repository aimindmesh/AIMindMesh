import { logger } from '../../logger';
import type { TaskRequest } from '../taskCompletion';

/** Model of an OpenRouter or local OpenAI-compatible request. */
export function resolveOpenAICompatibleModel(req: Pick<TaskRequest, 'llmConfig'>, isOpenRouter: boolean): string {
    return isOpenRouter
        ? (req.llmConfig.openrouterModel?.trim() || 'google/gemini-2.5-flash')
        : (req.llmConfig.localModel?.trim() || 'local-model');
}

/**
 * OpenRouter, or a local OpenAI-compatible server (Ollama, LM Studio, llama.cpp, vLLM), for app
 * tasks: the task's own system text, no persona. Local servers usually take no key.
 */
export async function* openAICompatibleTaskStream(req: TaskRequest, isOpenRouter: boolean): AsyncGenerator<string> {
    const { llmConfig, signal } = req;
    const endpoint = isOpenRouter
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : `${(llmConfig.localEndpoint || '').trim().replace(/\/+$/, '')}/chat/completions`;
    const apiKey = isOpenRouter ? llmConfig.openrouterApiKey?.trim() : undefined;
    if (isOpenRouter && !apiKey) throw new Error('OpenRouter API key is not configured.');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    if (isOpenRouter) {
        headers['HTTP-Referer'] = 'https://aimindmesh.local';
        headers['X-Title'] = 'AI Mind Mesh';
    }
    const model = resolveOpenAICompatibleModel(req, isOpenRouter);
    logger.log('info', `[TaskCompletion] ${isOpenRouter ? 'OpenRouter' : 'Local server'} with model ${model}`);

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: req.system },
                { role: 'user', content: req.prompt }
            ],
            stream: true,
            temperature: 0.3,
            max_tokens: req.maxTokens,
        }),
        signal
    });
    if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`LLM API returned error ${response.status}: ${errorText.slice(0, 300) || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel();
                throw new DOMException('Generation aborted by user', 'AbortError');
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue;
                if (trimmed === 'data: [DONE]') return;
                if (!trimmed.startsWith('data: ')) continue;
                let json: any;
                try {
                    json = JSON.parse(trimmed.slice(6));
                } catch {
                    continue; // malformed SSE chunk
                }
                if (json.error) throw new Error(json.error.message || 'The model returned an error');
                const content = json.choices?.[0]?.delta?.content;
                if (content) yield content;
            }
        }
    } finally {
        reader.releaseLock();
    }
}
