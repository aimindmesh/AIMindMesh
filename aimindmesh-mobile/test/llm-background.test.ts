import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    stream: vi.fn(),
    engineLoaded: true,
    activity: 'chat',
}));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/llmService', () => ({ generateTextResponseStream: mocks.stream }));
vi.mock('../src/services/model/modelOrchestrator', () => ({ getActivity: () => mocks.activity }));
vi.mock('../src/services/llm/nativeLLM', () => ({ getSlotModelInfo: () => ({ isLoaded: mocks.engineLoaded }) }));
vi.mock('../src/services/memory/semanticMemoryRetriever', () => ({
    getOrInitializeSemanticMemoryRetriever: async () => ({
        retrieveRelevantMemories: async () => [{ content: 'Trip to Rome in May', role: 'user', similarity: 0.9, timestamp: Date.UTC(2026, 8, 12) }],
        truncateToTokenLimit: (m: unknown[]) => m,
    }),
}));
vi.mock('../src/services/llm/contextInjector', () => ({ contextInjector: { buildSystemPromptWithContext: async () => '' } }));
// No embedding model: facts are matched by keywords
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({ ensureEmbeddingModel: async () => false }));

import { beginChatActivity, isChatIdleFor, resetChatActivity } from '../src/services/llm/background/chatActivity';
import { runExclusiveBackground, yieldToChat, isBackgroundTaskRunning } from '../src/services/llm/background/llmArbiter';
import { runBackgroundTask, ON_DEVICE_IDLE_MS } from '../src/services/llm/background/backgroundLlm';
import { asInternalTask, asBackgroundTask, isInternalTask, isBackgroundTask } from '../src/services/llm/background/taskFlags';
import { buildPromptContext, findUserTurnIndex, historyWithTurnContext } from '../src/services/llm/promptContext';
import { memoryTaskConfig } from '../src/services/memory/memoryLlmConfig';
import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import type { LLMConfig, Message } from '../src/types';

const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, timestamp: new Date() });
const persona = { name: 'Ada', description: 'friend', systemPrompt: 'Be kind.', traits: [] };

async function* textStream(parts: string[]) {
    for (const p of parts) yield { type: 'text', content: p };
}

beforeEach(() => {
    resetChatActivity();
    mocks.stream.mockReset();
    mocks.engineLoaded = true;
    mocks.activity = 'chat';
    vi.useRealTimers();
});

describe('task flags', () => {
    it('survive copies of the config but never reach the saved settings', () => {
        const config = asBackgroundTask(asInternalTask({ provider: 'gemini' } as LLMConfig));
        const copy = { ...config, nThreads: 4 };
        expect(isInternalTask(copy) && isBackgroundTask(copy)).toBe(true);
        expect(JSON.parse(JSON.stringify(copy))).toEqual({ provider: 'gemini', nThreads: 4 });
        expect(isInternalTask(memoryTaskConfig({ provider: 'gemini', enableSearch: true } as LLMConfig))).toBe(true);
        expect(memoryTaskConfig({ provider: 'gemini', enableSearch: true } as LLMConfig).enableSearch).toBe(false);
    });
});

describe('chat activity and arbiter', () => {
    it('counts nested generations and measures the quiet time from the last one', () => {
        const endA = beginChatActivity();
        const endB = beginChatActivity();
        endA();
        endA(); // idempotent
        expect(isChatIdleFor(0)).toBe(false);
        endB();
        expect(isChatIdleFor(0)).toBe(true);
        expect(isChatIdleFor(60_000)).toBe(false);
    });

    it('runs no background task while the chat generates', async () => {
        const end = beginChatActivity();
        expect(await runExclusiveBackground('t', async () => 'x')).toBeNull();
        end();
        expect(await runExclusiveBackground('t', async () => 'x')).toBe('x');
    });

    it('stops the background task for the chat and waits until it has stopped', async () => {
        const steps: string[] = [];
        const task = runExclusiveBackground('long', signal => new Promise<string>(resolve => {
            signal.addEventListener('abort', () => setTimeout(() => { steps.push('stopped'); resolve('partial'); }, 5));
        }));
        expect(isBackgroundTaskRunning()).toBe(true);
        expect(await runExclusiveBackground('other', async () => 'y')).toBeNull(); // one at a time
        await yieldToChat();
        steps.push('chat');
        expect(steps).toEqual(['stopped', 'chat']);
        expect(await task).toBe('partial');
        expect(isBackgroundTaskRunning()).toBe(false);
    });
});

describe('background tasks', () => {
    const local = { provider: 'native-gguf' } as LLMConfig;

    it('use an on-device model only after the quiet time, loaded, with the device free', async () => {
        beginChatActivity()();
        expect((await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: local })).skipped).toBe('chat_active');

        mocks.stream.mockImplementation(() => textStream(['Fact.']));
        const later = Date.now() + ON_DEVICE_IDLE_MS + 1;
        vi.useFakeTimers({ now: later, toFake: ['Date'] });
        mocks.engineLoaded = false;
        expect((await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: local })).skipped).toBe('engine_not_ready');
        mocks.engineLoaded = true;
        mocks.activity = 'image';
        expect((await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: local })).skipped).toBe('engine_not_ready');
        mocks.activity = 'chat';
        expect(await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: local })).toMatchObject({ text: 'Fact.', provider: 'native-gguf' });
        // Internal task, background, as a single 'sys_memory_req' turn
        const [history, , config] = mocks.stream.mock.calls[0];
        expect(history[0].id).toBe('sys_memory_req');
        expect(isInternalTask(config) && isBackgroundTask(config)).toBe(true);
    });

    it('never send a key to another vendor, and skip keyed providers without one', async () => {
        expect((await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: { provider: 'claude' } as LLMConfig })).skipped).toBe('no_key');
        localStorage.setItem('claude-api-key', JSON.stringify('sk-claude'));
        localStorage.setItem('gemini-api-key', JSON.stringify('gm-key'));
        mocks.stream.mockImplementation(() => textStream(['ok']));
        await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: { provider: 'claude' } as LLMConfig });
        expect(mocks.stream.mock.calls[0][3]).toBe('sk-claude'); // history, personality, config, apiKey
    });

    it('discard the text of an aborted run', async () => {
        mocks.stream.mockImplementation((_h: unknown, _p: unknown, _c: unknown, _k: unknown, signal: AbortSignal) => (async function* () {
            yield { type: 'text', content: 'half' };
            // The user writes: the chat stops this run (the abort itself is synchronous)
            void yieldToChat();
            if (signal.aborted) return; // like LiteRT: an aborted stream just ends
            yield { type: 'text', content: ' done' };
        })());
        localStorage.setItem('gemini-api-key', JSON.stringify('gm-key'));
        const result = await runBackgroundTask({ label: 't', prompt: 'p', llmConfig: { provider: 'gemini' } as LLMConfig });
        expect(result).toMatchObject({ text: null, skipped: 'aborted' });
    });
});

describe('prompt context', () => {
    it('queries memories for the real user turn, not for tool observations', () => {
        const history = [msg('1', 'user', 'Where am I going?'), msg('2', 'model', 'Let me check'), msg('tool_3', 'user', 'Observation: ...')];
        expect(findUserTurnIndex(history)).toBe(0);
        expect(findUserTurnIndex([msg('nudge_1', 'user', 'Continue')])).toBe(-1);
    });

    it('puts the profile in the system prompt and dates the conversation memories', async () => {
        factStore.resetForTests();
        await factStore.init(new LocalFactRepository());
        await factStore.add({ content: 'Wife is Giulia', kind: 'person', pinned: true });
        const context = await buildPromptContext({
            personality: persona,
            llmConfig: { provider: 'gemini', enableSemanticMemory: true, embeddingModelId: 'm' } as LLMConfig,
            history: [msg('1', 'user', 'Plans for May?')],
        });
        expect(context.systemPrompt).toContain('- (people) Wife is Giulia');
        expect(context.turnContext).toContain('FROM PAST CONVERSATIONS');
        expect(context.turnContext).toContain('[2026-09-12, the user said] Trip to Rome in May');
        const onDevice = historyWithTurnContext([msg('1', 'user', 'Plans for May?')], context);
        expect(onDevice[0].text).toMatch(/^<context>[\s\S]*Trip to Rome[\s\S]*<\/context>\n\nPlans for May\?$/);
    });

    it('gives internal tasks only their own instructions', async () => {
        const context = await buildPromptContext({
            personality: { ...persona, systemPrompt: 'Return JSON.' },
            llmConfig: memoryTaskConfig({ provider: 'gemini', enableSemanticMemory: true, embeddingModelId: 'm' } as LLMConfig),
            history: [msg('sys_memory_req', 'user', 'Extract')],
            onDevice: true,
        });
        expect(context).toEqual({ systemPrompt: 'Return JSON.', turnContext: '', turnIndex: -1 });
    });
});
