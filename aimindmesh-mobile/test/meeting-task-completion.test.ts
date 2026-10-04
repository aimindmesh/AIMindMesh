import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ app: [] as any[] }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/llmService', () => ({
  generateTextResponseStream: async function* (history: any[], personality: any, config: any, apiKey?: string, _signal?: AbortSignal, maxTokens?: number) {
    calls.app.push({ history, personality, config, apiKey, maxTokens });
    yield '<think>planning</think>';
    yield { type: 'text', content: '{"title":"Budget"}' };
  }
}));
vi.mock('../src/services/llm/providers/geminiTask', () => ({
  geminiTaskStream: async function* () { yield 'gemini'; },
  resolveGeminiTaskModel: (m?: string) => m || 'gemini-2.5-flash'
}));
vi.mock('../src/utils/fileSystemAdapter', () => ({ FileSystemAdapter: {}, Directory: { Cache: 'CACHE' } }));
vi.mock('../src/services/meeting/meetingStorage', () => ({ filesystemRefFor: (p: string) => ({ path: p }) }));

import { checkFits, isTaskLLMConfigured, streamTaskCompletion, stripThinking, supportsTaskAudio } from '../src/services/llm/taskCompletion';
import { isInternalTask } from '../src/services/llm/background/taskFlags';

const base = { localEndpoint: '', localModel: '' } as any;
const collect = async (gen: AsyncGenerator<string>) => { let t = ''; for await (const c of gen) t += c; return t; };

beforeEach(() => { calls.app = []; });

describe('task completions', () => {
  it('send only the task instructions through the app layer: no persona, no memories, no tools', async () => {
    const text = await collect(streamTaskCompletion({
      system: 'You write meeting notes.', prompt: 'Transcript...', llmConfig: { ...base, provider: 'claude' },
      keys: { claude: 'k' }, maxTokens: 1000
    }));
    expect(stripThinking(text)).toBe('{"title":"Budget"}');
    const [call] = calls.app;
    expect(call.personality.systemPrompt).toBe('You write meeting notes.');
    expect(isInternalTask(call.config)).toBe(true);
    expect(call.config).toMatchObject({ enableToolCalling: false, enableSemanticMemory: false, enableSearch: false });
    expect(call.apiKey).toBe('k');
    expect(call.maxTokens).toBe(1000);
  });

  it('put the instructions in the request for the AIMindMesh server, which drops system text', async () => {
    await collect(streamTaskCompletion({
      system: 'SYSTEM', prompt: 'PROMPT', llmConfig: { ...base, provider: 'claude' }, keys: {},
      serverSettings: { enabled: true, useAsDefaultProvider: true } as any, maxTokens: 100
    }));
    expect(calls.app[0].history[0].text).toBe('SYSTEM\n\nPROMPT');
  });

  it('refuse a transcript longer than the model takes instead of cutting it', () => {
    expect(() => checkFits({
      system: '', prompt: 'x'.repeat(40_000), llmConfig: { ...base, provider: 'native-gguf', nCtx: 4096 }, keys: {}, maxTokens: 1000
    })).toThrow(/too long/);
    expect(() => checkFits({ system: '', prompt: 'short', llmConfig: { ...base, provider: 'claude' }, keys: {}, maxTokens: 1000 })).not.toThrow();
  });

  it('know which providers are set up and which take audio', () => {
    expect(isTaskLLMConfigured({ ...base, provider: 'gemini' }, {})).toBe(false);
    expect(isTaskLLMConfigured({ ...base, provider: 'gemini' }, { gemini: 'k' })).toBe(true);
    expect(isTaskLLMConfigured({ ...base, provider: 'local', localEndpoint: 'http://lan:1234/v1' }, {})).toBe(true);
    expect(supportsTaskAudio({ ...base, provider: 'gemini' })).toBe(true);
    expect(supportsTaskAudio({ ...base, provider: 'native-gguf', engine: 'litert' })).toBe(true);
    expect(supportsTaskAudio({ ...base, provider: 'claude' })).toBe(false);
  });

  it('strip reasoning blocks before the answer', () => {
    expect(stripThinking('<think>a\nb</think>\n{"x":1}')).toBe('{"x":1}');
    expect(stripThinking('half thought</think>answer')).toBe('answer');
  });
});
