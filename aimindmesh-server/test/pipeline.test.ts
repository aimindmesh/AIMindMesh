import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../src/db/sqlite';

const mocks = vi.hoisted(() => ({
  routeTask: vi.fn(async () => { throw new Error('LLM must not be called'); }),
  classify: vi.fn(),
  createRepository: vi.fn(),
}));

vi.mock('../src/db/neo4j', () => ({ getSession: () => ({ run: async () => ({ records: [] }), close: async () => {} }) }));
vi.mock('../src/services/InferenceRouter', () => ({
  InferenceRouter: { onTaskCompleted: vi.fn(), routeTask: mocks.routeTask, complete: vi.fn() },
}));
vi.mock('../src/services/InferenceRegistry', () => ({ InferenceRegistry: { get: () => null } }));
vi.mock('../src/services/FeedManager', () => ({ FeedManager: { addItem: vi.fn() } }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/IntentClassifier', () => ({ IntentClassifier: { classify: mocks.classify } }));
vi.mock('../src/services/GiteaService', () => ({
  GiteaService: { createRepository: mocks.createRepository, listUserRepos: async () => [{ name: 'AIMindMesh' }] },
}));

import { autoEvolutionPipeline } from '../src/services/AutoEvolutionPipeline';
import { InferenceRouter } from '../src/services/InferenceRouter';
import { GiteaEvolutionService } from '../src/services/GiteaEvolutionService';

const insertCandidate = (id: string, target: string) =>
  db.prepare(`INSERT OR REPLACE INTO evolution_candidates (id, source, source_id, title, description, target_component, created_at, status)
              VALUES (?, 'manual', ?, 't', 'd', ?, ?, 'pending')`).run(id, id, target, Date.now()); // unique (source, source_id, title)
const lastFailure = (id: string) =>
  db.prepare(`SELECT failure_reason FROM evolution_attempts WHERE candidate_id = ? ORDER BY id DESC LIMIT 1`).get(id) as { failure_reason: string } | undefined;

beforeEach(() => {
  db.prepare(`DELETE FROM evolution_proposals`).run();
  mocks.routeTask.mockClear();
  mocks.createRepository.mockClear();
});

describe('candidate entry points', () => {
  it('fail a protected target before any file read or LLM call', async () => {
    insertCandidate('c-secret', 'aimindmesh-server/config.json');
    await (autoEvolutionPipeline as any).executeEvolutionForCandidate({
      id: 'c-secret', title: 't', severity: 9, repository: 'AIMindMesh', target_component: 'aimindmesh-server/config.json',
    });
    expect(lastFailure('c-secret')?.failure_reason).toBe('protected_path');
    expect(mocks.routeTask).not.toHaveBeenCalled();
    const row = db.prepare(`SELECT original_content FROM evolution_candidates WHERE id = 'c-secret'`).get() as any;
    expect(row.original_content).toBeNull();
  });

  it('refuse an LLM output that touches a protected file, without opening a PR', async () => {
    insertCandidate('c-output', 'aimindmesh-server/src/services/WikiManager.ts');
    const createProposal = vi.spyOn(GiteaEvolutionService.prototype, 'createProposal');
    const llmOutput = JSON.stringify({
      explanation: 'x', modifiedFileContent: 'export const a = 1;'.repeat(10), estimatedImpact: 'low', breakingChange: false, skip: false,
      additionalFiles: [{ path: 'aimindmesh-server/src/middleware/auth.ts', content: 'x', reason: 'r' }],
    });
    await autoEvolutionPipeline.resumeEvolutionFromOutput(
      { id: 'c-output', title: 't', status: 'generating', repository: 'AIMindMesh', target_component: 'aimindmesh-server/src/services/WikiManager.ts' },
      llmOutput,
    );
    expect(lastFailure('c-output')?.failure_reason).toBe('protected_path');
    expect(createProposal).not.toHaveBeenCalled();
  });
});

describe('chat requests (injectUserRequest)', () => {
  const developmentIntent = (targetFiles: string[], extra: Record<string, unknown> = {}) =>
    mocks.classify.mockResolvedValue({ category: 'DEVELOPMENT', projectName: 'AIMindMesh', taskMetadata: { targetFiles }, ...extra });

  it('share the daily cap with the cron cycle', async () => {
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO evolution_proposals (id, candidate_id, title, explanation, branch_name, pr_url, pr_number, target_component, created_at)
                  VALUES (?, 'c-secret', 't', 'e', 'b', 'u', ?, 'x', ?)`).run(`p${i}`, i, Date.now());
    }
    developmentIntent(['aimindmesh-server/src/services/WikiManager.ts']);
    const res = await autoEvolutionPipeline.injectUserRequest('improve the wiki', 'conv');
    expect(res).toMatchObject({ success: true });
    expect(res.candidateId).toBeUndefined();
    expect(res.message).toContain('Daily auto-evolution limit');
  });

  it('refuse protected targets', async () => {
    developmentIntent(['.noautoedit']);
    const res = await autoEvolutionPipeline.injectUserRequest('edit the protection list', 'conv');
    expect(res.candidateId).toBeUndefined();
    expect(res.message).toContain('protected');
  });

  it('refuse invalid project names before creating any repository', async () => {
    mocks.classify.mockResolvedValue({ category: 'NEW_PROJECT', projectName: '../evil', taskMetadata: {} });
    const res = await autoEvolutionPipeline.injectUserRequest('new project', 'conv');
    expect(res.candidateId).toBeUndefined();
    expect(mocks.createRepository).not.toHaveBeenCalled();
  });
});

describe('init (boot, then again on every config PATCH)', () => {
  it('registers the inference listener and recovers stuck candidates only once', async () => {
    const status = (id: string) => (db.prepare(`SELECT status FROM evolution_candidates WHERE id = ?`).get(id) as any).status;
    insertCandidate('c-validating', 'aimindmesh-server/src/services/WikiManager.ts');
    db.prepare(`UPDATE evolution_candidates SET status = 'validating' WHERE id = 'c-validating'`).run();

    await autoEvolutionPipeline.init();
    expect(status('c-validating')).toBe('pending'); // interrupted by the restart

    db.prepare(`UPDATE evolution_candidates SET status = 'validating' WHERE id = 'c-validating'`).run();
    await autoEvolutionPipeline.init();
    await autoEvolutionPipeline.init();

    expect(InferenceRouter.onTaskCompleted).toHaveBeenCalledTimes(1);
    expect(status('c-validating')).toBe('validating'); // a live validation is left alone
  });
});
