import { beforeEach, describe, expect, it, vi } from 'vitest';

const genie = vi.hoisted(() => ({
    isLoaded: vi.fn(),
    loadModel: vi.fn(async () => ({ success: true, runtime: 'llama_cpp', computeUnit: 'npu' })),
    formatChat: vi.fn(async () => ({ prompt: '<template prompt>' })),
    generateStream: vi.fn(),
    abortGeneration: vi.fn(async () => ({ success: true })),
    unloadModel: vi.fn(async () => ({ success: true })),
}));

vi.mock('genie-capacitor', () => ({ Genie: genie }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/model/modelOrchestrator', () => ({ ensureResident: vi.fn(async () => {}), markUnloaded: vi.fn() }));
vi.mock('../src/services/llm/promptContext', () => ({
    buildPromptContext: vi.fn(async () => ({ systemPrompt: 'SYS' })),
    historyWithTurnContext: (history: unknown) => history,
}));
vi.mock('../src/services/tools', () => ({ parseReActToolCalls: () => ({ calls: [] }) }));
vi.mock('../src/services/toolDefinitions', () => ({ getReActSystemPromptCompact: () => '' }));
vi.mock('../src/services/llm/context/unifiedContextManager', () => ({
    refineContext: (messages: unknown, systemPrompt: string) => ({ messages, systemPrompt }),
    getResponseReserve: () => 256,
    withReasoningAllowance: (n: number) => n,
}));

import { generateGenieNPUStream, initGenieModel } from '../src/services/llm/providers/genieProvider';
import { formatBundlePrompt, genieLoadMatches, toTemplateMessages } from '../src/services/llm/providers/genieSupport';
import { formatGenieProfile, getLastGenieProfile, resetGenieStatsForTests } from '../src/services/llm/npuStats';
import type { Message } from '../src/types';

const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, timestamp: new Date() });
const history = [msg('1', 'user', 'Ciao'), msg('2', 'model', 'Ciao!'), msg('3', 'system', '(System: reminder)'), msg('4', 'user', 'Come va?')];
const profile = { ttftMs: 412.4, promptTokens: 800, generatedTokens: 96, promptTimeMs: 400, decodeTimeMs: 5000, prefillSpeed: 2000, decodingSpeed: 19.2, computeUnit: 'npu' };

async function collect(modelPath: string) {
    genie.generateStream.mockImplementation(async (_options: unknown, callback: (r: unknown) => void) => {
        callback({ text: 'Bene', done: false });
        callback({ text: '', done: true, profile });
        return 'id';
    });
    let text = '';
    for await (const chunk of generateGenieNPUStream(history, { name: 'Aria' } as any, { nativeModelPath: modelPath } as any)) {
        if (chunk.type === 'text') text += chunk.content;
    }
    return text;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetGenieStatsForTests();
    genie.isLoaded.mockResolvedValue({ loaded: false });
});

describe('Genie prompts', () => {
    it('a GGUF gets the prompt from its own chat template, with the roles alternating', async () => {
        expect(await collect('/data/files/Qwen3.5-4B-Q4_0.gguf')).toBe('Bene');
        expect(genie.formatChat).toHaveBeenCalledWith({
            messages: [
                { role: 'system', content: expect.stringMatching(/^SYS\n\nScrivi sempre e solo in italiano/) },
                { role: 'user', content: 'Ciao' },
                { role: 'assistant', content: 'Ciao!' },
                { role: 'user', content: '(System: reminder)\n\nCome va?' },
            ],
            enableThinking: false,
        });
        const [options] = genie.generateStream.mock.calls[0] as any[];
        expect(options).toMatchObject({ prompt: '<template prompt>', stopSequences: undefined, maxTokens: 256 });
        expect(getLastGenieProfile()).toMatchObject({ model: 'Qwen3.5-4B-Q4_0.gguf', decodingSpeed: 19.2 });
    });

    it('an AI Hub bundle without a template: ChatML with its stop words', async () => {
        genie.formatChat.mockRejectedValueOnce(new Error('No chat template for the loaded model'));
        await collect('/data/files/models/genie/qwen3_4b_instruct');
        const [options] = genie.generateStream.mock.calls[0] as any[];
        expect(options.prompt).toMatch(/^<\|im_start\|>system\nSYS\n\nScrivi sempre e solo in italiano[^<]*<\|im_end\|>\n/);
        expect(options.prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
        expect(options.stopSequences).toEqual(['<|im_end|>', '<|endoftext|>']);
    });

    it('falls back to the built-in format if the template fails', async () => {
        genie.formatChat.mockRejectedValueOnce(new Error('no template'));
        await collect('/data/files/gemma-4-E2B_q4_0-it.gguf');
        const [options] = genie.generateStream.mock.calls[0] as any[];
        expect(options.prompt.endsWith('<|turn>model\n')).toBe(true);
    });

    it('a vision model gets the images of the request being answered, in its image slots', async () => {
        genie.isLoaded.mockResolvedValue({ loaded: true, isVision: true, runtime: 'qairt' });
        genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => { cb({ text: '', done: true }); return 'id'; });
        const withImage = [msg('1', 'user', 'Ciao'), msg('2', 'model', 'Ciao!'),
            { ...msg('3', 'user', 'Cosa vedi?'), images: [{ base64: 'QUJD', mimeType: 'image/png' }] }] as Message[];
        for await (const _ of generateGenieNPUStream(withImage, { name: 'Aria' } as any, { nativeModelPath: '/f/models/genie/gemma_4_e4b_it' } as any)) { /* drain */ }
        const [{ messages }] = genie.formatChat.mock.calls[0] as any[];
        expect(messages.map((m: any) => m.imageCount ?? 0)).toEqual([0, 0, 0, 1]);
        const [options] = genie.generateStream.mock.calls[0] as any[];
        expect(options.images).toEqual(['data:image/png;base64,QUJD']);
    });

    it('a text model gets no images', async () => {
        const withImage = [{ ...msg('1', 'user', 'Cosa vedi?'), images: [{ base64: 'QUJD', mimeType: 'image/png' }] }] as Message[];
        genie.generateStream.mockImplementation(async (_o: unknown, cb: (r: unknown) => void) => { cb({ text: '', done: true }); return 'id'; });
        for await (const _ of generateGenieNPUStream(withImage, { name: 'Aria' } as any, { nativeModelPath: '/f/x.gguf' } as any)) { /* drain */ }
        const [options] = genie.generateStream.mock.calls[0] as any[];
        expect(options.images).toBeUndefined();
    });

    it('a Gemma 4 bundle gets the Gemma 4 turns', () => {
        const { prompt, stopSequences } = formatBundlePrompt('/f/models/genie/gemma_4_e4b_it-geniex_qairt', 'S', [msg('a', 'user', 'Ciao')], 'Atlas');
        expect(prompt).toBe('<bos><|turn>system\nS<turn|>\n<|turn>user\nCiao<turn|>\n<|turn>model\n');
        expect(stopSequences).toEqual(['<turn|>']);
    });

    it('merges consecutive turns of the same role', () => {
        expect(toTemplateMessages('S', [msg('a', 'user', 'x'), msg('b', 'user', 'y')]).map(m => m.content)).toEqual(['S', 'x\n\ny']);
    });
});

describe('Genie loading', () => {
    it('reloads a GGUF when the configured unit or context changed, not otherwise', async () => {
        const path = '/data/files/Qwen3.5-2B-Q4_0.gguf';
        genie.isLoaded.mockResolvedValue({ loaded: true, modelPath: path, runtime: 'llama_cpp', computeUnit: 'gpu', contextLength: 4096 });
        expect(await initGenieModel(path, { genieRuntime: 'auto' } as any)).toBe(true);
        expect(genie.loadModel).not.toHaveBeenCalled();

        expect(await initGenieModel(path, { genieRuntime: 'npu', contextMode: 'manual', contextSize: 8192 } as any)).toBe(true);
        expect(genie.loadModel).toHaveBeenCalledWith({ modelPath: path, runtime: 'npu', contextLength: 8192 });
    });

    it('QAIRT bundles ignore unit and context', () => {
        expect(genieLoadMatches({ runtime: 'qairt', computeUnit: 'npu' }, 'cpu', 8192)).toBe(true);
        expect(genieLoadMatches({ runtime: 'llama_cpp', computeUnit: 'npu', contextLength: 4096 }, 'auto', 8192)).toBe(false);
    });

    it('describes the measured speed', () => {
        expect(formatGenieProfile(profile)).toBe('NPU · first token 412 ms · prompt 800 tok at 2000 tok/s · answer 96 tok at 19.2 tok/s');
    });
});
