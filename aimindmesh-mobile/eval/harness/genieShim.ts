/**
 * Stand-in for the `genie-capacitor` plugin backed by llama-server: the app's genieProvider,
 * prompt and parsing code run unchanged, the model runs on the PC (same GGUF as the phone).
 */
import { applyTemplate, complete } from './llamaServer';
import { toOpenAIMessages } from '../../src/services/llm/chatFormat/openAiChat';

interface GenieMessage {
    role: string;
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    toolCallId?: string;
    toolName?: string;
}

export interface ShimRecord { prompt: string; output: string; promptTokens: number; generatedTokens: number; ms: number }

export const shimState = {
    modelPath: '/data/user/0/com.aimindmesh.mobile/files/gemma-4-E4B_q4_0-it.gguf',
    contextLength: 4096,
    last: null as ShimRecord | null,
    calls: [] as ShimRecord[],
};

export function resetShim() {
    shimState.last = null;
    shimState.calls = [];
}

export const genieShim = {
    async getCapabilities() {
        return { hasNpu: true, npuArch: 'v79', socModel: 'SM8750', supportedRuntimes: ['cpu', 'gpu', 'npu'], ggufNpuSupported: true, qairtSupported: true };
    },
    async isLoaded() {
        return { loaded: true, modelPath: shimState.modelPath, modelName: shimState.modelPath.split('/').pop(), runtime: 'llama_cpp', computeUnit: 'npu', contextLength: shimState.contextLength, isVision: false, precision: 'Q4_0' };
    },
    async loadModel(options: { modelPath: string; contextLength?: number }) {
        shimState.modelPath = options.modelPath;
        if (options.contextLength) shimState.contextLength = options.contextLength;
        return { success: true, runtime: 'llama_cpp', computeUnit: 'npu', contextLength: shimState.contextLength };
    },
    async unloadModel() { return { success: true }; },
    async listLocalModels() { return { models: [] }; },
    async abortGeneration() { return { success: true }; },
    /** GenieChatMessage → OpenAI messages for llama-server's /apply-template (same Jinja template) */
    async formatChat(options: { messages: GenieMessage[]; enableThinking?: boolean; tools?: string }) {
        const messages = toOpenAIMessages(options.messages as never);
        const tools = options.tools ? JSON.parse(options.tools) as unknown[] : undefined;
        return { prompt: await applyTemplate(messages, { tools, enableThinking: options.enableThinking }) };
    },
    async generateStream(
        options: { prompt: string; maxTokens?: number; temperature?: number; topP?: number; stopSequences?: string[]; grammar?: string },
        callback: (result: unknown, err?: unknown) => void,
    ) {
        try {
            const result = await complete(options.prompt, {
                n_predict: options.maxTokens ?? 512,
                temperature: options.temperature ?? 0.7,
                top_p: options.topP ?? 0.9,
                top_k: 40,
                min_p: 0.05,
                stop: options.stopSequences,
                ...(options.grammar ? { grammar: options.grammar } : {}),
            });
            const t = result.timings;
            shimState.last = { prompt: options.prompt, output: result.content, promptTokens: t.prompt_n, generatedTokens: t.predicted_n, ms: t.prompt_ms + t.predicted_ms };
            shimState.calls.push(shimState.last);
            if (result.content) callback({ text: result.content, done: false });
            callback({
                text: '', done: true,
                profile: {
                    ttftMs: t.prompt_ms, promptTokens: t.prompt_n, generatedTokens: t.predicted_n, promptTimeMs: t.prompt_ms,
                    decodeTimeMs: t.predicted_ms, prefillSpeed: t.prompt_per_second, decodingSpeed: t.predicted_per_second, computeUnit: 'cpu',
                },
            });
        } catch (e) {
            callback({ done: true, error: String(e) });
        }
        return 'eval';
    },
};
