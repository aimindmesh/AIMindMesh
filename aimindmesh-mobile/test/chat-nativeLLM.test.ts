import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake LlamaCpp plugin: streams the given tokens, keeps "generating" until interrupted or done
const native = vi.hoisted(() => {
  const state = {
    listeners: [] as Array<(d: any) => void>,
    finish: null as null | (() => void),
    calls: [] as any[],
    interrupts: 0,
  };
  const plugin = {
    getSmolLMMetrics: vi.fn(async () => ({ isLoaded: true, modelPath: 'm.gguf', messageCount: 1 })),
    getFormattedChat: vi.fn(async () => ({ prompt: 'PROMPT' })),
    addListener: vi.fn(async (_event: string, cb: (d: any) => void) => {
      state.listeners.push(cb);
      return { remove: () => { state.listeners = state.listeners.filter(l => l !== cb); } };
    }),
    streamingCompletion: vi.fn((opts: any) => {
      state.calls.push(opts);
      return new Promise<void>(resolve => {
        state.finish = resolve;
        setTimeout(() => state.listeners.forEach(l => l({ contextId: 0, token: 'Hello <tool>x()</tool> more' })), 0);
      });
    }),
    interruptSmolLM: vi.fn(async () => { state.interrupts++; state.finish?.(); }),
  };
  return { state, plugin };
});

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => native.plugin,
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/utils/platform', () => ({ isDesktop: () => false }));

import { initNativeModel, generateNativeStream } from '../src/services/llm/nativeLLM';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => { }); // initNativeModel's debug output
  native.state.calls = [];
  native.state.interrupts = 0;
});

describe('native generation stream', () => {
  it('interrupts the native generation when the reader stops early, before releasing the slot', async () => {
    await initNativeModel({ modelPath: 'm.gguf' });
    for await (const chunk of generateNativeStream({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 64, temperature: 0.2 })) {
      expect(chunk).toContain('</tool>');
      break; // As ggufProvider does on a tool call
    }
    expect(native.state.interrupts).toBe(1);
    expect(native.state.calls[0]).toMatchObject({ prompt: 'PROMPT', nPredict: 64, temperature: 0.2 });
  });

  it('does not interrupt a generation that finished on its own', async () => {
    native.plugin.streamingCompletion.mockImplementationOnce((opts: any) => {
      native.state.calls.push(opts);
      return new Promise<void>(resolve => setTimeout(() => {
        native.state.listeners.forEach(l => l({ contextId: 0, token: 'Done.' }));
        resolve();
      }, 0));
    });
    let text = '';
    for await (const chunk of generateNativeStream({ prompt: 'p' })) text += chunk;
    expect(text).toBe('Done.');
    expect(native.state.interrupts).toBe(0);
  });
});
