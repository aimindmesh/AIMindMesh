import { describe, expect, it } from 'vitest';
import { isCloudLock, isCloudProvider, isCloudTarget, taskCategory } from '../src/services/inference/providerIds';
import { providerCooldownMs } from '../src/services/inference/providerCooldown';
import { flattenPrompt, promptParts } from '../src/services/inference/promptParts';
import type { TaskPayload } from '../src/services/InferenceRouter';

const task = (over: Partial<TaskPayload> = {}): TaskPayload => ({ type: 'GENERAL_CHAT', prompt: 'p', ...over });

describe('provider ids', () => {
  it('tells cloud targets from nodes', () => {
    for (const id of ['GEMINI', 'gemini_api', 'OPENROUTER_API', 'FREELLMAPI', 'CLAUDE']) expect(isCloudProvider(id)).toBe(true);
    expect(isCloudProvider('LAPTOP')).toBe(false);
    expect(isCloudTarget('')).toBe(true);
    expect(isCloudTarget('AUTO')).toBe(true);
    expect(isCloudTarget('SOME_API_NODE')).toBe(true); // historical rule
    expect(isCloudTarget('SERVER_LOCAL')).toBe(false);
  });

  it('keeps the leaked cloud lock rule', () => {
    expect(isCloudLock('GEMINI:GEMINI')).toBe(true);
    expect(isCloudLock('OPENROUTER:OPENROUTER')).toBe(true);
    expect(isCloudLock('CLAUDE:CLAUDE')).toBe(true);
    expect(isCloudLock('SERVER_LOCAL:OLLAMA')).toBe(false);
  });

  it('maps task types to their routing category', () => {
    expect(taskCategory('GENERAL_CHAT')).toBe('STANDARD');
    expect(taskCategory('ORGANIZATION_DESIGN')).toBe('COMPLEX');
    expect(taskCategory('EVOLUTION')).toBe('EVOLUTION');
    expect(taskCategory('WEB_RESEARCH')).toBe('RESEARCH');
    expect(taskCategory('UNKNOWN')).toBeNull();
  });
});

describe('provider cooldowns', () => {
  it('doubles the FreeLLMAPI wait from 30 s up to 1 h', () => {
    const item = { id: 'abcdefgh', payload: task(), lastProvider: 'FREELLMAPI' };
    expect(providerCooldownMs(item, 'HTTP 429 rate limit')).toBe(30_000);
    expect(providerCooldownMs(item, 'HTTP 429 rate limit')).toBe(60_000);
    item.payload.currentWaitMs = 3_000_000;
    expect(providerCooldownMs(item, 'fetch failed')).toBe(3_600_000);
    expect(providerCooldownMs(item, 'bad request')).toBeNull();
  });

  it('waits an hour on the Gemini daily quota and retries 429 a bounded number of times', () => {
    const item = { id: 'abcdefgh', payload: task(), lastProvider: 'GEMINI' };
    expect(providerCooldownMs(item, 'GEMINI_DAILY_QUOTA_REACHED')).toBe(3_600_000);
    expect(providerCooldownMs(item, 'GEMINI_QUOTA_EXCEEDED: 5')).toBe(20_000);
    expect(item.payload.retryCount).toBe(1);
    item.payload.retryCount = 20;
    expect(providerCooldownMs(item, 'GEMINI_QUOTA_EXCEEDED: 5')).toBeNull();
  });

  it('ignores other providers', () => {
    expect(providerCooldownMs({ id: 'abcdefgh', payload: task(), lastProvider: 'OPENROUTER' }, '429')).toBeNull();
  });
});

describe('prompt parts', () => {
  it('returns the prompt alone without search or prefix', () => {
    expect(flattenPrompt(task({ prompt: 'hello' }))).toBe('hello');
  });

  it('wraps the prompt with the search instruction and puts the cache prefix first', () => {
    const payload = task({ prompt: 'q', searchContext: 'results', cachePrefix: 'shared context' });
    const parts = promptParts(payload);
    expect(parts.cachePrefix).toBe('shared context');
    expect(parts.body).toContain('[Search Results]\nresults');
    expect(parts.body.endsWith('USER: q')).toBe(true);
    expect(flattenPrompt(payload)).toBe(`shared context\n\n${parts.body}`);
  });
});
