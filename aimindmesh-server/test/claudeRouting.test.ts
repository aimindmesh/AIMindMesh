import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), isReachable: vi.fn(async () => false) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

// A scripted SDK client: each stream() call takes the next scripted outcome
const script: Array<{ message?: any; error?: unknown; deltas?: string[]; thinking?: string[] }> = [];
const streamCalls: any[] = [];
vi.mock('../src/services/inference/claude/claudeClient', () => ({
  claudeKeyFingerprint: () => 'sk-ant-…test',
  claudeClient: () => ({
    beta: {
      messages: {
        stream: (params: any) => {
          streamCalls.push(params);
          const step = script.shift() ?? { message: reply('default') };
          const handlers: Record<string, Array<(d: string) => void>> = {};
          return {
            on(event: string, fn: (d: string) => void) { (handlers[event] ??= []).push(fn); return this; },
            async finalMessage() {
              if (step.error) throw step.error;
              for (const d of step.thinking ?? []) handlers.thinking?.forEach(f => f(d));
              for (const d of step.deltas ?? []) handlers.text?.forEach(f => f(d));
              return step.message;
            },
          };
        },
      },
    },
  }),
}));

import db from '../src/db/sqlite';
import { config } from '../src/config';
import { InferenceRouter } from '../src/services/InferenceRouter';
import { InferenceProviders } from '../src/services/InferenceProviders';
import { ClaudeCreditState } from '../src/services/inference/claude/ClaudeCreditState';
import { ClaudeUsage } from '../src/services/inference/claude/ClaudeUsage';
import { resetClaudeProvider } from '../src/services/inference/claude/ClaudeProvider';
import { handleCompletion } from '../src/api/websocket/chatCompletion';

function reply(text: string, extra: Record<string, unknown> = {}) {
  return {
    model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...extra,
  };
}

const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());

beforeEach(() => {
  script.length = 0;
  streamCalls.length = 0;
  (config as any).claude = { apiKey: 'sk-ant-test-key-0000' };
  (config as any).openrouter = { apiKey: 'or-key', model: 'test', dailyQuotaCap: 0 };
  (config as any).routing = { preferredNode: 'AUTO', taskPriorities: { STANDARD: ['OPENROUTER'], LIGHTWEIGHT: ['OPENROUTER'] } };
  db.prepare('DELETE FROM claude_usage').run();
  ClaudeUsage.resetCache();
  ClaudeCreditState.reset();
  resetClaudeProvider();
});

afterEach(() => {
  (config as any).claude = { apiKey: '' };
  (config as any).openrouter = { apiKey: '', model: 'test', dailyQuotaCap: 0 };
  (config as any).routing = { preferredNode: 'AUTO', taskPriorities: {} };
  ClaudeCreditState.reset();
});

describe('Claude in the priority lists', () => {
  it('goes first in the chosen categories unless the list places it', () => {
    expect(InferenceProviders.effectivePriorities('GENERAL_CHAT')).toEqual(['CLAUDE', 'OPENROUTER']);
    expect(InferenceProviders.effectivePriorities('INTENT_CLASSIFICATION')).toEqual(['OPENROUTER']);
    (config as any).routing.taskPriorities.GENERAL_CHAT = ['OPENROUTER', 'CLAUDE'];
    expect(InferenceProviders.effectivePriorities('GENERAL_CHAT')).toEqual(['OPENROUTER', 'CLAUDE']);
  });

  it('is skipped without a key, for types it does not serve and when the task failed on it', () => {
    expect(InferenceProviders.resolveTarget({ type: 'GENERAL_CHAT' }, [])).toEqual({ provider: 'CLAUDE', engine: 'CLAUDE' });
    expect(InferenceProviders.resolveTarget({ type: 'GENERAL_CHAT', options: { skipProviders: ['CLAUDE'] } }, []).provider).toBe('OPENROUTER');
    expect(InferenceProviders.resolveTarget({ type: 'EMBEDDING_GENERATION', options: { routing: 'CLAUDE' } }, []).provider).not.toBe('CLAUDE');
    (config as any).claude = { apiKey: '' };
    expect(InferenceProviders.resolveTarget({ type: 'GENERAL_CHAT', options: { routing: 'CLAUDE' } }, []).provider).toBe('OPENROUTER');
  });

  it('accepts the admin mobile spelling of the cloud providers', () => {
    expect(InferenceProviders.resolveTarget({ type: 'GENERAL_CHAT', options: { routing: 'OPENROUTER_API' } }, []).provider).toBe('OPENROUTER');
  });
});

describe('Claude dispatch', () => {
  it('answers with the category model and effort, and records the usage', async () => {
    script.push({ message: reply('hello') });
    const res = await InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'hi', options: { model: 'llama3' } });

    expect(res).toEqual({ provider: 'CLAUDE', response: 'hello' });
    const params = streamCalls[0];
    expect(params.model).toBe('claude-sonnet-5-5'); // a non-Claude options.model is ignored
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.temperature).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(params.messages[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(ClaudeUsage.day().calls).toBe(1);
    expect(ClaudeUsage.day().costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6);
  });

  it('caches the shared prefix as its own block', async () => {
    script.push({ message: reply('ok') });
    await InferenceRouter.routeTask({ type: 'DEBATE_PARTICIPATION', prompt: 'persona', cachePrefix: 'debate context' });
    expect(streamCalls[0].messages[0].content).toEqual([
      { type: 'text', text: 'debate context', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'persona' },
    ]);
  });

  it('moves the task to the next provider when the credit runs out, and stops using Claude', async () => {
    script.push({ error: apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.') });
    const openRouter = vi.spyOn(InferenceProviders, 'callOpenRouter').mockResolvedValue('from openrouter');

    const res = await InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'hi' });
    expect(res).toEqual({ provider: 'OPENROUTER', response: 'from openrouter' });
    expect(ClaudeCreditState.availability().state).toBe('credit_exhausted');

    await InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'again' });
    expect(streamCalls).toHaveLength(1);
    expect(openRouter).toHaveBeenCalledTimes(2);
  });

  it('never retries a refused task on Claude, and rejects a task routed explicitly to Claude', async () => {
    script.push({ message: reply('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } }) });
    vi.spyOn(InferenceProviders, 'callOpenRouter').mockResolvedValue('fallback');
    await expect(InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'x' })).resolves.toMatchObject({ provider: 'OPENROUTER' });
    expect(ClaudeCreditState.availability().state).toBe('ok');

    script.push({ error: apiError(529, 'overloaded_error', 'busy') });
    await expect(InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'x', options: { routing: 'CLAUDE' } })).rejects.toThrow('CLAUDE_TRANSIENT');
  });

  it('retries once without the fallback beta when the organization rejects it', async () => {
    script.push({ error: apiError(400, 'invalid_request_error', 'Unexpected value(s) for the `anthropic-beta` header') }, { message: reply('ok') });
    await expect(InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'x' })).resolves.toMatchObject({ provider: 'CLAUDE', response: 'ok' });
    expect(streamCalls[1].fallbacks).toBeUndefined();
    expect(streamCalls[1].betas).toBeUndefined();
  });

  it('streams the answer and the reasoning summary to a phone chat', async () => {
    script.push({ message: reply('Hello there'), deltas: ['Hello', ' there'], thinking: ['Thinking…'] });
    const events: any[] = [];
    await handleCompletion(e => events.push(e), {
      type: 'completion', requestId: 'r1', messages: [{ role: 'user', content: 'hi' }], options: { thinking: true },
    } as any);

    expect(streamCalls[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(streamCalls[0].output_config).toEqual({ effort: 'high' });
    expect(events.filter(e => e.type === 'delta').map(e => e.content)).toEqual(['Hello', ' there']);
    expect(events.filter(e => e.type === 'thought').map(e => e.content)).toEqual(['Thinking…']);
    expect(events.at(-1)).toMatchObject({ type: 'done', usedNode: 'CLAUDE' });
  });
});
