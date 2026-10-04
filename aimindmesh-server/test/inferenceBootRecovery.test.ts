import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../src/db/sqlite';

const mocks = vi.hoisted(() => ({ triggerDevelopmentAgent: vi.fn(), runKasmValidation: vi.fn() }));

vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), isReachable: vi.fn(async () => false) }));
vi.mock('../src/services/GeminiQueueManager', () => ({ GeminiQueueManager: { init: vi.fn(async () => {}) } }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));
vi.mock('../src/services/organization/VentureOrchestrator', () => ({ VentureOrchestrator: mocks }));

import { InferenceRouter } from '../src/services/InferenceRouter';

describe('inference queue boot recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ends interrupted venture agent tasks instead of re-triggering them', async () => {
    db.prepare(`INSERT INTO organization_repositories (id, repo_name, namespace, gitea_url, bootstrap_template, created_at)
                VALUES ('repo1', 'idea', 'aimindmesh-labs', 'http://gitea:3000/aimindmesh-labs/idea', 'node-webapp', '')`).run();
    const insert = db.prepare(`INSERT INTO inference_queue (id, type, task_name, model, status, payload, created_at) VALUES (?, 'AGENT_TASK', 't', ?, ?, ?, ?)`);
    const payload = JSON.stringify({ repoId: 'repo1', repoName: 'idea', sessionKey: 'develop-idea' });
    insert.run('a1', 'openclaw', 'PROCESSING', payload, Date.now());
    insert.run('a2', 'kasm-validation', 'QUEUED', payload, Date.now());

    await InferenceRouter.init();
    await vi.advanceTimersByTimeAsync(10_000);

    const rows = db.prepare(`SELECT id, status, error_msg FROM inference_queue WHERE type = 'AGENT_TASK' ORDER BY id`).all();
    expect(rows).toEqual([
      { id: 'a1', status: 'FAILED', error_msg: 'Interrupted by restart' },
      { id: 'a2', status: 'FAILED', error_msg: 'Interrupted by restart' },
    ]);
    expect(mocks.triggerDevelopmentAgent).not.toHaveBeenCalled();
    expect(mocks.runKasmValidation).not.toHaveBeenCalled();
  });
});
