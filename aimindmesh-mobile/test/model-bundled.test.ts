import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({ statuses: [] as Array<{ status: string; error?: string }> }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ getStatus: async () => plugin.statuses.shift() ?? { status: 'ready' } })
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

describe('waitForBundledModels', () => {
  it('waits while the models are being unpacked', async () => {
    plugin.statuses = [{ status: 'running' }, { status: 'running' }, { status: 'ready' }];
    const { waitForBundledModels } = await import('../src/services/model/bundledModels');
    let done = false;
    const wait = waitForBundledModels().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await wait;
    expect(done).toBe(true);
  });

  it('fails with the native error, and a later call asks again', async () => {
    plugin.statuses = [{ status: 'failed', error: 'disk full' }, { status: 'ready' }];
    const { waitForBundledModels } = await import('../src/services/model/bundledModels');
    await expect(waitForBundledModels()).rejects.toThrow('disk full');
    await expect(waitForBundledModels()).resolves.toBeUndefined();
  });
});
