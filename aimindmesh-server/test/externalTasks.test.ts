import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), isReachable: vi.fn(async () => false) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

import { InferenceRouter } from '../src/services/InferenceRouter';
import { InferenceRegistry } from '../src/services/InferenceRegistry';
import { config } from '../src/config';

function startExternal(id: string) {
  const cancel = vi.fn();
  InferenceRegistry.register(id, 'AGENT_TASK', 'Venture build: x', 'openclaw', { repoId: 'r', repoName: 'x' }, 'openclaw');
  InferenceRegistry.setStatus(id, 'PROCESSING');
  // an hour old: any untracked PROCESSING task this old is a "zombie"
  Object.assign(InferenceRegistry.get(id) as any, { startedAt: Date.now() - 60 * 60_000, processingStartedAt: Date.now() - 60 * 60_000 });
  InferenceRouter.trackExternalTask(id, cancel);
  return cancel;
}

afterEach(() => {
  (config as any).infrastructureBrake = false;
});

describe('external tasks in the inference router', () => {
  it('are not killed by the zombie check', () => {
    startExternal('ext-1');
    InferenceRouter.checkStaleTasks();
    expect(InferenceRegistry.get('ext-1')?.status).toBe('PROCESSING');
    InferenceRouter.untrackExternalTask('ext-1');
    InferenceRouter.checkStaleTasks();
    expect(InferenceRegistry.get('ext-1')).toBeUndefined(); // untracked: now it is a zombie
  });

  it('cancel and the brake call their cancel function and never re-queue them', () => {
    const cancel = startExternal('ext-2');
    InferenceRouter.cancelTask('ext-2');
    expect(cancel).toHaveBeenCalledTimes(1);

    const braked = startExternal('ext-3');
    InferenceRouter.setBrake(true);
    expect(braked).toHaveBeenCalledTimes(1);
    expect((InferenceRouter as any).taskQueue.some((t: any) => t.id === 'ext-3')).toBe(false);
  });

  it('cannot be re-routed to another provider', () => {
    startExternal('ext-4');
    expect(InferenceRouter.updateQueuedTask('ext-4', 'GEMINI')).toBe(false);
    InferenceRouter.untrackExternalTask('ext-4');
  });
});
