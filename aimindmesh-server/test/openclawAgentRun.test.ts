import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  startAgentRun: vi.fn(),
  waitForAgentRun: vi.fn(),
  abortAgentRun: vi.fn(async () => true),
  getLastAssistantReply: vi.fn(async () => 'from history'),
}));
vi.mock('../src/services/OpenClawBridge', () => bridge);

import { openClawAgentRunner, runStrict } from '../src/services/openclaw/agentRun';

beforeEach(() => {
  Object.values(bridge).forEach(fn => fn.mockClear());
  bridge.startAgentRun.mockResolvedValue('run-1');
});

describe('strict OpenClaw runs', () => {
  it('gives the gateway the time budget in seconds and returns the final text', async () => {
    bridge.waitForAgentRun.mockResolvedValue({ phase: 'end', output: 'final text' });
    const result = await runStrict('do it', 'develop-x', { timeoutMs: 120_000 });
    expect(result).toEqual({ status: 'ok', reply: 'final text' });
    expect(bridge.startAgentRun).toHaveBeenCalledWith('do it', 'develop-x', { timeout: 180 });
  });

  it('falls back to the session history when the run ends without text', async () => {
    bridge.waitForAgentRun.mockResolvedValue({ phase: 'end' });
    expect((await runStrict('p', 'develop-x', { timeoutMs: 60_000 })).reply).toBe('from history');
  });

  it('aborts the run on the gateway when the wait times out', async () => {
    bridge.waitForAgentRun.mockResolvedValue(null);
    const result = await runStrict('p', 'develop-x', { timeoutMs: 60_000 });
    expect(result.status).toBe('timeout');
    expect(bridge.abortAgentRun).toHaveBeenCalledWith('develop-x', 'run-1');
  });

  it('reports errors and disconnections instead of replying with them', async () => {
    bridge.waitForAgentRun.mockResolvedValueOnce({ phase: 'error', error: 'provider down' });
    expect(await runStrict('p', 'k', { timeoutMs: 1000 })).toEqual({ status: 'error', reply: '', error: 'provider down' });
    bridge.waitForAgentRun.mockResolvedValueOnce({ phase: 'disconnected', error: 'closed' });
    expect((await runStrict('p', 'k', { timeoutMs: 1000 })).status).toBe('disconnected');
    bridge.startAgentRun.mockRejectedValueOnce(new Error('not connected'));
    expect(await runStrict('p', 'k', { timeoutMs: 1000 })).toEqual({ status: 'error', reply: '', error: 'not connected' });
  });

  it('routes a chosen build model through the builder provider', async () => {
    bridge.waitForAgentRun.mockResolvedValue({ phase: 'end', output: 'ok' });
    const signal = new AbortController().signal;
    await openClawAgentRunner.run('p', 'develop-x', { timeoutMs: 60_000, signal, model: 'gemini-3.1-pro-preview' });
    expect(bridge.startAgentRun).toHaveBeenCalledWith('p', 'develop-x', { provider: 'aimindmesh-builder', model: 'gemini-3.1-pro-preview', timeout: 120 });
    await openClawAgentRunner.run('p', 'develop-x', { timeoutMs: 60_000, signal, model: null });
    expect(bridge.startAgentRun).toHaveBeenLastCalledWith('p', 'develop-x', { timeout: 120 });
  });
});
