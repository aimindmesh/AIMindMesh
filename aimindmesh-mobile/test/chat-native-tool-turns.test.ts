import { beforeEach, describe, expect, it, vi } from 'vitest';

const genie = vi.hoisted(() => ({
    isLoaded: vi.fn(async () => ({ loaded: true, modelPath: '/f/gemma-4-E2B_q4_0-it.gguf', runtime: 'llama_cpp', computeUnit: 'npu', contextLength: 8192 })),
    loadModel: vi.fn(),
    formatChat: vi.fn(),
    generateStream: vi.fn(),
    abortGeneration: vi.fn(async () => ({ success: true })),
    getCapabilities: vi.fn(async () => ({ hasNpu: true, npuArch: 'v79', supportedRuntimes: [] })),
}));
vi.mock('genie-capacitor', () => ({ Genie: genie }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('../src/services/model/modelOrchestrator', () => ({ ensureResident: vi.fn(async () => {}), markUnloaded: vi.fn() }));
vi.mock('../src/services/llm/promptContext', () => ({
    buildPromptContext: vi.fn(async () => ({ systemPrompt: 'SYS', turnContext: '', turnIndex: -1, language: 'it' })),
    historyWithTurnContext: (history: unknown) => history,
}));

import { generateGenieNPUStream } from '../src/services/llm/providers/genieProvider';
import { toTemplateMessages } from '../src/services/llm/providers/genieSupport';
import { visibleText } from '../src/services/llm/chatFormat/nativeToolStream';
import { resetNativeToolSupportForTests } from '../src/services/llm/chatFormat/nativeToolSupport';
import { toolDeclarations } from '../src/services/tools/nativeToolDeclarations';
import type { LLMConfig, Message } from '../src/types';

const at = new Date();
const history: Message[] = [
    { id: 'u', role: 'user', text: 'Che tempo fa domani?', timestamp: at },
    { id: 'm', role: 'model', text: '<tool>search_web({"query":"meteo"})</tool>', timestamp: at, toolMeta: { calls: [{ id: 'c1', name: 'search_web', args: { query: 'meteo' } }] } },
    { id: 't', role: 'user', text: 'Observation:\n[search_web]: Sole', timestamp: at, toolMeta: { results: [{ id: 'c1', name: 'search_web', success: true, result: 'Sole' }] } },
];

describe('tool turns in the native format', () => {
    it('become assistant tool calls and tool messages, or stay text without it', () => {
        expect(toTemplateMessages('S', history, 0, true).slice(2)).toEqual([
            { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_web', arguments: '{"query":"meteo"}' }] },
            { role: 'tool', content: 'Sole', toolCallId: 'c1', toolName: 'search_web' },
        ]);
        expect(toTemplateMessages('S', history, 0, false).map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('declares the allowed tools as JSON schema', () => {
        const [web] = toolDeclarations(['search_web', 'no_such_tool']);
        expect(web.function.name).toBe('search_web');
        expect(web.function.parameters).toMatchObject({ type: 'object', properties: { query: { type: 'string' } } });
        expect(toolDeclarations(['search_web'], { search_web: 'deny' })).toEqual([]);
    });

    it('never shows the call while streaming', () => {
        expect(visibleText('Controllo il meteo.<|tool_call>call:search_web{', 'gemma4')).toBe('Controllo il meteo.');
        expect(visibleText('Controllo<|tool_', 'gemma4')).toBe('Controllo');
        expect(visibleText('Riga\ncal', 'gemma4')).toBe('Riga\n');
        expect(visibleText('Ciao!', 'gemma4', true)).toBe('Ciao!');
        expect(visibleText('Uso <tool_call>{"name":"x"}', 'qwen3')).toBe('Uso ');
    });
});

describe('Genie provider with native tools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetNativeToolSupportForTests();
        genie.formatChat.mockImplementation(async ({ tools }: { tools?: string }) => ({ prompt: `<prompt with ${tools ?? 'no tools'}>` }));
    });

    it('declares the tools in the template, stops after the call and parses it', async () => {
        genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => {
            cb({ text: 'Cerco.<|tool_call>call:search_web{query:<|"|>meteo domani<|"|>}<tool_call|>', done: false });
            cb({ text: '', done: true });
            return 'id';
        });
        const config = { nativeModelPath: '/f/gemma-4-E2B_q4_0-it.gguf', enableToolCalling: true, enableThinking: true } as LLMConfig;
        const chunks: Array<{ type: string; content?: string; call?: unknown }> = [];
        for await (const c of generateGenieNPUStream(history.slice(0, 1), { name: 'Atlas' } as any, config)) chunks.push(c as any);

        const calls = genie.formatChat.mock.calls;
        const format = calls[calls.length - 1][0];
        expect(JSON.parse(format.tools).map((t: any) => t.function.name)).toContain('search_web');
        expect(format.enableThinking).toBe(true); // native reasoning stays on with tools
        expect(format.messages[0].content).toMatch(/Non dire mai di aver fatto un'azione/);
        expect(genie.generateStream.mock.calls[0][0].stopSequences).toEqual(['<|tool_response>']);
        expect(chunks.filter(c => c.type === 'text').map(c => c.content).join('')).toBe('Cerco.');
        expect(chunks.find(c => c.type === 'function_call')?.call).toEqual({ name: 'search_web', args: { query: 'meteo domani' } });
    });

    it('a Gemma 4 bundle without a template gets the app-written format, tools included', async () => {
        genie.isLoaded.mockResolvedValue({ loaded: true, modelPath: '/f/models/genie/gemma_4_e4b_it', runtime: 'qairt', computeUnit: 'npu' } as any);
        genie.formatChat.mockRejectedValue(new Error('no template'));
        genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => { cb({ text: 'Ciao!', done: true }); return 'id'; });
        const config = { nativeModelPath: '/f/models/genie/gemma_4_e4b_it', enableToolCalling: true } as LLMConfig;
        for await (const _ of generateGenieNPUStream(history.slice(0, 1), { name: 'Atlas' } as any, config)) { /* drain */ }
        const options = genie.generateStream.mock.calls[0][0];
        expect(options.prompt).toMatch(/^<bos><\|turn>system\nSYS[\s\S]*<\|tool>declaration:search_web\{/);
        expect(options.prompt.endsWith('<|turn>user\nChe tempo fa domani?<turn|>\n<|turn>model\n')).toBe(true);
        expect(options.stopSequences).toEqual(['<turn|>', '<|tool_response>']);
    });

    it('a bundle template that drops the tools keeps the ReAct prompt', async () => {
        genie.isLoaded.mockResolvedValue({ loaded: true, modelPath: '/f/models/genie/gemma_4_e4b_it', runtime: 'qairt', computeUnit: 'npu' } as any);
        genie.formatChat.mockResolvedValue({ prompt: '<vlm template without tools>' }); // the probe tool is not rendered
        genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => { cb({ text: 'Ok', done: true }); return 'id'; });
        const config = { nativeModelPath: '/f/models/genie/gemma_4_e4b_it', enableToolCalling: true } as LLMConfig;
        for await (const _ of generateGenieNPUStream(history.slice(0, 1), { name: 'Atlas' } as any, config)) { /* drain */ }
        const last = genie.formatChat.mock.calls[genie.formatChat.mock.calls.length - 1][0];
        expect(last.tools).toBeUndefined();
        expect(last.messages[0].content).toContain('## Tools');
    });
});
