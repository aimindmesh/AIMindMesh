import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
    getSlotModelInfo: vi.fn(() => ({ isLoaded: true, contextId: 0, modelPath: 'gemma-4-E2B_q4_0-it.gguf', multimodalProj: null })),
    generateNativeStream: vi.fn(),
    renders: vi.fn(async () => true),
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('genie-capacitor', () => ({ Genie: { getCapabilities: async () => ({ npuArch: 'v79' }) } }));
vi.mock('../src/services/llm/nativeLLM', () => ({ getSlotModelInfo: native.getSlotModelInfo, generateNativeStream: native.generateNativeStream }));
vi.mock('../src/services/llm/providers/GGUF/initialization', () => ({ initializeNativeModel: vi.fn(async () => ({})), checkMultimodalCapabilities: vi.fn(async () => false) }));
vi.mock('../src/services/llm/providers/GGUF/mediaHandler', () => ({ processAudioAttachments: async (h: unknown) => h, prepareImagesForProcessing: async () => [] }));
vi.mock('../src/services/llm/providers/GGUF/contextSync', () => ({ syncGGUFContext: vi.fn(async () => {}) }));
vi.mock('../src/services/llm/providers/GGUF/ggufToolSupport', () => ({ ggufTemplateRendersTools: native.renders }));
vi.mock('../src/services/llm/promptContext', () => ({
    buildPromptContext: vi.fn(async () => ({ systemPrompt: 'SYS', turnContext: '', turnIndex: -1, language: 'it' })),
    historyWithTurnContext: (history: unknown) => history,
}));

import { generateNativeGGUFStream } from '../src/services/llm/providers/ggufProvider';
import type { LLMConfig, Message } from '../src/types';

const at = new Date();
const turn = (text: string): Message => ({ id: 'u', role: 'user', text, timestamp: at });

async function run(config: Partial<LLMConfig>, history: Message[], output: string[]) {
    native.generateNativeStream.mockImplementation(async function* () { for (const t of output) yield t; });
    const chunks: any[] = [];
    for await (const c of generateNativeGGUFStream(history, { name: 'Atlas' } as any, { provider: 'native-gguf', nativeModelPath: 'gemma-4-E2B_q4_0-it.gguf', ...config } as LLMConfig)) chunks.push(c);
    return { chunks, options: native.generateNativeStream.mock.calls[0][0] };
}

describe('llama.cpp engine with native tools', () => {
    beforeEach(() => vi.clearAllMocks());

    it('passes the declarations and the thinking flag to the template and parses the call', async () => {
        const { chunks, options } = await run({ enableToolCalling: true, enableThinking: true }, [turn('Sveglia alle 7')],
            ['Imposto.', '<|tool_call>call:set_alarm{hour:7,minute:0}<tool_call|>']);
        expect(JSON.parse(options.tools).map((t: any) => t.function.name)).toContain('set_alarm');
        expect(options.enableThinking).toBe(true);
        expect(options.stop).toEqual(['<|tool_response>']);
        expect(options.messages[0].content).toMatch(/^SYS[\s\S]*Non dire mai di aver fatto/);
        expect(chunks.filter(c => c.type === 'text').map(c => c.content).join('')).toBe('Imposto.');
        expect(chunks.find(c => c.type === 'function_call').call).toEqual({ name: 'set_alarm', args: { hour: 7, minute: 0 } });
    });

    it('sends the earlier tool turns as tool_calls and tool results', async () => {
        const history: Message[] = [
            turn('Che tempo fa?'),
            { id: 'm', role: 'model', text: '<tool>search_web({})</tool>', timestamp: at, toolMeta: { calls: [{ id: 'c1', name: 'search_web', args: { query: 'meteo' } }] } },
            { id: 't', role: 'user', text: 'Observation: Sole', timestamp: at, toolMeta: { results: [{ id: 'c1', name: 'search_web', success: true, result: 'Sole' }] } },
        ];
        const { options } = await run({ enableToolCalling: true }, history, ['Domani c\'è il sole.']);
        expect(options.messages.slice(1)).toEqual([
            { role: 'user', content: 'Che tempo fa?' },
            { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_web', arguments: '{"query":"meteo"}' } }] },
            { role: 'tool', content: 'Sole', tool_call_id: 'c1', name: 'search_web' },
        ]);
    });

    it('reasoning stays off unless the setting turns it on', async () => {
        const { options } = await run({ enableToolCalling: false, enableThinking: false }, [turn('Ciao')], ['Ciao!']);
        expect(options.enableThinking).toBe(false);
        expect(options.tools).toBeUndefined();
    });
});
