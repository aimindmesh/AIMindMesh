import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), isReachable: vi.fn(async () => false) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

// Scripted Batches API: each created batch ends after `pollsBeforeEnd` polls with `results`
const api = {
  created: [] as Array<{ id: string; requests: any[] }>,
  cancelled: [] as string[],
  pollsBeforeEnd: 0,
  polls: new Map<string, number>(),
  results: (requests: any[]): any[] => requests.map(r => ({ custom_id: r.custom_id, result: { type: 'succeeded', message: reply(`answer ${r.custom_id}`) } })),
};
vi.mock('../src/services/inference/claude/claudeClient', () => ({
  claudeKeyFingerprint: () => 'sk-ant-…test',
  claudeClient: () => ({
    beta: {
      messages: {
        batches: {
          create: vi.fn(async ({ requests }: any) => {
            const id = `batch_${api.created.length + 1}`;
            api.created.push({ id, requests });
            return { id, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
          }),
          retrieve: vi.fn(async (id: string) => {
            const n = (api.polls.get(id) ?? 0) + 1;
            api.polls.set(id, n);
            return { id, processing_status: n > api.pollsBeforeEnd ? 'ended' : 'in_progress' };
          }),
          results: vi.fn(async (id: string) => {
            const batch = api.created.find(b => b.id === id)!;
            return (async function* () { yield* api.results(batch.requests); })();
          }),
          cancel: vi.fn(async (id: string) => { api.cancelled.push(id); return { id }; }),
        },
      },
    },
  }),
}));

import db from '../src/db/sqlite';
import { config } from '../src/config';
import { ClaudeBatchQueue } from '../src/services/inference/claude/ClaudeBatchQueue';
import { ClaudeCreditState } from '../src/services/inference/claude/ClaudeCreditState';
import { ClaudeUsage } from '../src/services/inference/claude/ClaudeUsage';
import { InferenceRouter } from '../src/services/InferenceRouter';

function reply(text: string) {
  return {
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

const POLL = 5_000;
const opts = { taskType: 'WIKI_SYNTHESIS', parts: { body: 'write the page' } };
const settle = () => vi.advanceTimersByTimeAsync(POLL + 10);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate'] });
  api.created.length = 0;
  api.cancelled.length = 0;
  api.polls.clear();
  api.pollsBeforeEnd = 0;
  api.results = requests => requests.map(r => ({ custom_id: r.custom_id, result: { type: 'succeeded', message: reply(`answer ${r.custom_id}`) } }));
  (config as any).claude = { apiKey: 'sk-ant-test-key-0000', batch: { windowMs: 0, pollMs: POLL } };
  (config as any).infrastructureBrake = false;
  db.prepare('DELETE FROM claude_batch_requests').run();
  db.prepare('DELETE FROM claude_usage').run();
  ClaudeUsage.resetCache();
  ClaudeCreditState.reset();
  ClaudeBatchQueue.resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
  (config as any).claude = { apiKey: '' };
  (config as any).infrastructureBrake = false;
  ClaudeBatchQueue.resetForTests();
});

describe('Claude batch queue', () => {
  it('waits for start, submits, polls and returns the result at half price', async () => {
    api.pollsBeforeEnd = 1;
    const result = ClaudeBatchQueue.submitAndWait('task-1', opts);
    await vi.advanceTimersByTimeAsync(10);
    expect(api.created).toHaveLength(0); // not started yet: listeners may be missing

    ClaudeBatchQueue.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.created).toHaveLength(1);
    expect(api.created[0].requests[0]).toMatchObject({ custom_id: 'task-1', params: { model: 'claude-opus-5-5', output_config: { effort: 'high' } } });
    expect(api.created[0].requests[0].params.fallbacks).toBeUndefined();
    expect(ClaudeBatchQueue.reserved().total).toBeGreaterThan(0);

    await settle(); // in progress
    await settle(); // ended
    await expect(result).resolves.toBe('answer task-1');
    expect(ClaudeUsage.day().costUsd).toBeCloseTo(2); // 1M input tokens on Opus 5.5, halved
    expect(ClaudeBatchQueue.has('task-1')).toBe(false);
    expect(ClaudeBatchQueue.reserved().total).toBe(0);
  });

  it('never pays twice: a task dispatched again after a brake waits for its existing request', async () => {
    ClaudeBatchQueue.start();
    const brake = new AbortController();
    const first = ClaudeBatchQueue.submitAndWait('task-2', opts, brake.signal);
    await vi.advanceTimersByTimeAsync(10);
    brake.abort('BRAKE');
    await expect(first).rejects.toThrow('CLAUDE_ABORTED');

    const second = ClaudeBatchQueue.submitAndWait('task-2', opts);
    await settle();
    await expect(second).resolves.toBe('answer task-2');
    expect(api.created).toHaveLength(1);
  });

  it('after a restart, follows the open batches and hands their stored results to the re-dispatched task', async () => {
    db.prepare(`INSERT INTO claude_batch_requests (task_id, batch_id, status, params, source, est_cost_usd, attempts, created_at)
      VALUES ('task-3', 'batch_old', 'submitted', ?, 'router', 0.1, 0, ?)`).run(JSON.stringify({ taskType: 'WIKI_SYNTHESIS', request: { model: 'claude-opus-5-5' } }), Date.now());
    api.created.push({ id: 'batch_old', requests: [{ custom_id: 'task-3' }] });

    ClaudeBatchQueue.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(ClaudeBatchQueue.has('task-3')).toBe(true); // done, waiting for its task

    await expect(ClaudeBatchQueue.submitAndWait('task-3', opts)).resolves.toBe('answer task-3');
    expect(api.created).toHaveLength(1);
  });

  it('drops a request re-routed before it was sent, and cancels a batch it had alone', async () => {
    (config as any).claude.batch.windowMs = 1_000;
    ClaudeBatchQueue.start();
    const reroute = new AbortController();
    const pending = ClaudeBatchQueue.submitAndWait('task-4', opts, reroute.signal);
    reroute.abort('REROUTE');
    await expect(pending).rejects.toThrow('CLAUDE_ABORTED');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(api.created).toHaveLength(0);

    const cancel = new AbortController();
    const sent = ClaudeBatchQueue.submitAndWait('task-5', opts, cancel.signal);
    await vi.advanceTimersByTimeAsync(1_100);
    cancel.abort('CANCEL');
    await expect(sent).rejects.toThrow('CLAUDE_ABORTED');
    expect(api.cancelled).toEqual(['batch_1']);
  });

  it('sends nothing while the infrastructure brake is on', async () => {
    (config as any).infrastructureBrake = true;
    ClaudeBatchQueue.start();
    void ClaudeBatchQueue.submitAndWait('task-6', opts).catch(() => undefined);
    await settle();
    expect(api.created).toHaveLength(0);
    (config as any).infrastructureBrake = false;
    await settle();
    expect(api.created).toHaveLength(1);
  });

  it('resubmits an expired request once, then fails it', async () => {
    api.results = requests => requests.map(r => ({ custom_id: r.custom_id, result: { type: 'expired' } }));
    ClaudeBatchQueue.start();
    const result = ClaudeBatchQueue.submitAndWait('task-7', opts);
    result.catch(() => undefined);
    await settle();
    await settle();
    await settle();
    await expect(result).rejects.toThrow('CLAUDE_TRANSIENT');
    expect(api.created).toHaveLength(2);
  });
});

describe('batchable tasks in the router', () => {
  it('go to the Batches API and resolve their caller', async () => {
    (config as any).routing = { preferredNode: 'AUTO', taskPriorities: {} };
    ClaudeBatchQueue.start();
    const res = InferenceRouter.routeTask({ type: 'WIKI_SYNTHESIS', prompt: 'page', options: { batchable: true } });
    await settle();
    await settle();
    const out = await res;
    expect(out.provider).toBe('CLAUDE');
    expect(out.response).toMatch(/^answer /);
    expect(api.created[0].requests[0].params.messages[0].content).toEqual([{ type: 'text', text: 'page' }]);
  });
});
