import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), isReachable: vi.fn(async () => false) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({
  SearchService: {
    search: vi.fn(async () => [{ title: 'r1' }]),
    formatResultsForContext: vi.fn(() => '[1] r1'),
  },
}));

import { InferenceRouter } from '../src/services/InferenceRouter';
import { InferenceProviders } from '../src/services/InferenceProviders';
import { SearchService } from '../src/services/SearchService';
import { config } from '../src/config';

/** A provider call that stays pending until resolved, and rejects when the router aborts it. */
function pendingCall() {
  let resolve!: (text: string) => void;
  const calls: AbortSignal[] = [];
  const impl = (_prompt: string, signal?: AbortSignal) => new Promise<string>((res, rej) => {
    if (signal) calls.push(signal);
    resolve = res;
    signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  return { impl, calls, resolve: (text: string) => resolve(text) };
}

afterEach(() => {
  InferenceRouter.setBrake(false);
  (config as any).infrastructureBrake = false;
});

describe('re-queued tasks keep their caller', () => {
  it('a brake does not leave the caller waiting: the same promise resolves after it', async () => {
    const call = pendingCall();
    const spy = vi.spyOn(InferenceProviders, 'callFreeLLMAPI').mockImplementation(call.impl as any);
    const result = InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'hi', options: { routing: 'FREELLMAPI' } });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    InferenceRouter.setBrake(true);
    InferenceRouter.setBrake(false);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    call.resolve('after brake');

    await expect(result).resolves.toMatchObject({ provider: 'FREELLMAPI', response: 'after brake' });
    expect(spy).toHaveBeenCalledTimes(2); // the aborted attempt was not retried on its own
  });

  it('a cancel rejects the caller instead of leaving it waiting', async () => {
    const call = pendingCall();
    const spy = vi.spyOn(InferenceProviders, 'callFreeLLMAPI').mockImplementation(call.impl as any);
    const result = InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'hi', options: { routing: 'FREELLMAPI' } });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const [id] = [...(InferenceRouter as any).items.keys()];
    InferenceRouter.cancelTask(id);
    await expect(result).rejects.toThrow('CANCELLED_BY_USER');
  });

  it('a re-route resolves the same caller with the new provider', async () => {
    const call = pendingCall();
    const free = vi.spyOn(InferenceProviders, 'callFreeLLMAPI').mockImplementation(call.impl as any);
    const openRouter = vi.spyOn(InferenceProviders, 'callOpenRouter').mockResolvedValue('from openrouter');
    const result = InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'hi', options: { routing: 'FREELLMAPI' } });
    await vi.waitFor(() => expect(free).toHaveBeenCalledTimes(1));

    const [id] = [...(InferenceRouter as any).items.keys()];
    expect(InferenceRouter.updateQueuedTask(id, 'OPENROUTER')).toBe(true);

    await expect(result).resolves.toMatchObject({ provider: 'OPENROUTER', response: 'from openrouter' });
    expect(openRouter).toHaveBeenCalledTimes(1);
    expect(free).toHaveBeenCalledTimes(1);
  });
});

describe('web search before dispatch', () => {
  it('runs once: a retry reuses the results and the prompt is not wrapped twice', async () => {
    const openRouter = vi.spyOn(InferenceProviders, 'callOpenRouter')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('answer');

    const res = await InferenceRouter.routeTask({ type: 'GENERAL_CHAT', prompt: 'what is new?', options: { routing: 'OPENROUTER', searchEnabled: true } });

    expect(res.response).toBe('answer');
    expect(SearchService.search).toHaveBeenCalledTimes(1);
    expect(SearchService.search).toHaveBeenCalledWith('what is new?');
    const [first, second] = openRouter.mock.calls.map(c => c[0] as string);
    expect(first).toBe(second);
    expect(first.match(/USER: /g)).toHaveLength(1);
    expect(first).toContain('[Search Results]\n[1] r1');
    expect(first.endsWith('USER: what is new?')).toBe(true);
  });
});
