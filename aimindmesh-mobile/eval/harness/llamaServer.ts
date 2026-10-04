/** Client of a local llama-server (tools/server of llama.cpp b9309) used by the harness. */

export const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8080';

export interface CompletionOptions {
    n_predict?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    stop?: string[];
    seed?: number;
    grammar?: string;
}

export interface CompletionResult {
    content: string;
    timings: { prompt_n: number; prompt_ms: number; prompt_per_second: number; predicted_n: number; predicted_ms: number; predicted_per_second: number };
    stop_type?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${LLAMA_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<T>;
}

export async function serverModel(): Promise<string> {
    const res = await fetch(`${LLAMA_URL}/props`);
    if (!res.ok) throw new Error(`llama-server not reachable at ${LLAMA_URL}`);
    const props = await res.json() as { model_path?: string };
    return (props.model_path || 'unknown').split('/').pop()!;
}

/** The model's own chat template (same as GenieX/llama.cpp applyChatTemplate) */
export async function applyTemplate(messages: unknown[], options: { tools?: unknown[]; enableThinking?: boolean } = {}): Promise<string> {
    const body: Record<string, unknown> = { messages, chat_template_kwargs: { enable_thinking: !!options.enableThinking } };
    if (options.tools?.length) body.tools = options.tools;
    return (await post<{ prompt: string }>('/apply-template', body)).prompt;
}

export async function complete(prompt: string, options: CompletionOptions): Promise<CompletionResult> {
    return post<CompletionResult>('/completion', { prompt, cache_prompt: true, ...options });
}

export async function countTokens(text: string): Promise<number> {
    return (await post<{ tokens: number[] }>('/tokenize', { content: text, add_special: false, parse_special: true })).tokens.length;
}
