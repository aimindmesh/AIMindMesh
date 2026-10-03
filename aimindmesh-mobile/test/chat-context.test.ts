import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { refineContext, getResponseReserve, getProviderContextWindow } from '../src/services/llm/context/unifiedContextManager';
import { toChatRole, toGeminiRole, lastUserText } from '../src/services/llm/roles';
import { resolveClaudeModel, DEFAULT_CLAUDE_MODEL } from '../src/services/llm/claudeModels';
import type { LLMConfig, Message } from '../src/types';

const msg = (role: Message['role'], text: string, i = 0): Message => ({ id: `m${i}`, role, text, timestamp: new Date(0) });
const config = (extra: Partial<LLMConfig> = {}) => ({ provider: 'gemini', nCtx: 2048, ...extra }) as LLMConfig;

describe('context refinement', () => {
  it('keeps half of a small window for input when the response style is larger than the window', () => {
    expect(getResponseReserve(2048, 4000)).toBe(1024);
    expect(getResponseReserve(2048, 512)).toBe(512);
    expect(getResponseReserve(8192, 1500)).toBe(1500);
  });

  it('never returns an empty history, even with a response budget above the context size', () => {
    const history = [msg('user', 'hello '.repeat(50), 1), msg('model', 'hi', 2), msg('user', 'question?', 3)];
    const result = refineContext(history, '', config(), 4000);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[result.messages.length - 1].text).toBe('question?');
  });

  it('truncates but keeps an oversized last message', () => {
    const long = 'word '.repeat(5000);
    const result = refineContext([msg('user', long)], '', config(), 1500);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text.endsWith('...[Truncated]')).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('prunes remote providers against their own window, not the on-device nCtx', () => {
    const history = Array.from({ length: 40 }, (_, i) => msg(i % 2 ? 'model' : 'user', 'some sentence of text '.repeat(20), i));
    const small = refineContext(history, '', config(), 1500);
    const gemini = refineContext(history, '', config(), 1500, getProviderContextWindow('gemini'));
    expect(small.messages.length).toBeLessThan(history.length);
    expect(gemini.messages).toHaveLength(history.length);
    expect(getProviderContextWindow('native-gguf')).toBeUndefined();
  });
});

describe('roles', () => {
  it('maps hidden system triggers to user turns and model to the assistant role', () => {
    expect(toChatRole('model')).toBe('assistant');
    expect(toChatRole('system')).toBe('user');
    expect(toGeminiRole('system')).toBe('user');
    expect(toGeminiRole('model')).toBe('model');
    expect(lastUserText([msg('user', 'a'), msg('system', 'b'), msg('model', 'c')])).toBe('b');
  });
});

describe('claude model', () => {
  it('replaces missing and retired model ids with the default', () => {
    expect(resolveClaudeModel(undefined)).toBe(DEFAULT_CLAUDE_MODEL);
    expect(resolveClaudeModel('claude-3-5-sonnet-latest')).toBe(DEFAULT_CLAUDE_MODEL);
    expect(resolveClaudeModel('claude-3-opus-latest')).toBe(DEFAULT_CLAUDE_MODEL);
    expect(resolveClaudeModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
  });
});
