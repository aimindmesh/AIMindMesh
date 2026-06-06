import { Message, Personality, LLMConfig, Memory } from '../../../types';
import { logger } from '../../logger';
import { buildSystemPrompt } from '../promptBuilder';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface OpenRouterModel {
    id: string;
    name: string;
    description: string;
    pricing: {
        prompt: string;
        completion: string;
    };
    context_length: number;
}

/**
 * Maps internal Message history to OpenRouter's chat format.
 */
function mapHistory(history: Message[]): { role: string; content: string }[] {
    return history.map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.text,
    }));
}

/**
 * Streaming provider for OpenRouter.
 * Compatible with OpenAI chat completions API (SSE streaming).
 */
export async function* generateOpenRouterStream(
    history: Message[],
    personality: Personality,
    llmConfig: LLMConfig,
    memories: Memory[] = [],
    apiKey?: string,
    signal?: AbortSignal,
    maxResponseLength?: number
): AsyncGenerator<string> {
    const effectiveApiKey = apiKey || llmConfig.openrouterApiKey || '';
    if (!effectiveApiKey) {
        throw new Error('OpenRouter API key is required. Please configure it in Settings → LLM → OpenRouter.');
    }

    const model = llmConfig.openrouterModel || 'google/gemini-2.0-flash-lite:free';
    const systemPrompt = buildSystemPrompt(personality, memories);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...mapHistory(history),
    ];

    logger.log('info', `[OpenRouter] Sending request. Model: ${model}, Messages: ${messages.length}`);

    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${effectiveApiKey}`,
            'HTTP-Referer': 'https://aimindmesh.app',
            'X-Title': 'AIMindMesh Mobile',
        },
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            max_tokens: maxResponseLength || 8192,
            temperature: personality.llmParams?.temperature ?? 0.7,
            top_p: personality.llmParams?.topP ?? 0.9,
        }),
        signal,
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`OpenRouter error (HTTP ${response.status}): ${errText}`);
    }

    if (!response.body) {
        throw new Error('OpenRouter returned an empty response body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (signal?.aborted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') return;

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                } catch {
                    // Malformed SSE chunk — skip
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Fetches the list of available models from OpenRouter.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
    try {
        const response = await fetch(OPENROUTER_MODELS_URL, {
            method: 'GET',
            headers: {
                'HTTP-Referer': 'https://aimindmesh.app',
                'X-Title': 'AIMindMesh Mobile',
            },
        });

        if (!response.ok) {
            throw new Error(`OpenRouter models fetch failed (HTTP ${response.status})`);
        }

        const data = await response.json();
        return data.data || [];
    } catch (error) {
        logger.log('error', '[OpenRouter] Failed to fetch models', error);
        throw error;
    }
}
