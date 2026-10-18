import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { GeminiQueueManager } from '../src/services/GeminiQueueManager';
import { InferenceProviders } from '../src/services/InferenceProviders';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  (config as any).gemini = { apiKey: '', model: 'test', dailyQuotaCap: 1000, rpmLimit: 2 };
  (GeminiQueueManager as any).rpmTimestamps.clear();
});

afterEach(() => {
  vi.useRealTimers();
  (config as any).gemini = { apiKey: '', model: 'test', dailyQuotaCap: 0 };
});

describe('GeminiQueueManager per-minute limit', () => {
  it('holds the call over rpmLimit until the minute has passed', async () => {
    const call = vi.spyOn(InferenceProviders, 'callGemini').mockResolvedValue('ok');
    const results = [1, 2, 3].map(n => GeminiQueueManager.enqueue(`p${n}`, undefined, undefined, 'key-a'));

    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(call).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(call).toHaveBeenCalledTimes(3);
    await expect(Promise.all(results)).resolves.toEqual(['ok', 'ok', 'ok']);
  });
});
