import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import db from '../src/db/sqlite';

const mocks = vi.hoisted(() => ({
  runAgentTask: vi.fn(),
  characterizeIdea: vi.fn(),
  reviewIdea: vi.fn(),
}));

vi.mock('../src/db/neo4j', () => ({ getSession: () => ({ run: async () => ({ records: [] }), close: async () => {} }) }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: vi.fn(), cancelTask: vi.fn(), routeTask: vi.fn() } }));
vi.mock('../src/services/OpenClawBridge', () => ({
  runAgentTask: mocks.runAgentTask,
  getSessionHistory: vi.fn(async () => []),
  isSessionActive: vi.fn(() => false),
}));
vi.mock('../src/services/organization/DesignOrchestrator', () => ({ DesignOrchestrator: { characterizeIdea: mocks.characterizeIdea } }));
vi.mock('../src/services/organization/CouncilOrchestrator', () => ({
  CouncilOrchestrator: class { reviewIdea = mocks.reviewIdea; },
}));

import { VentureOrchestrator } from '../src/services/organization/VentureOrchestrator';
import { VentureScheduler } from '../src/services/organization/venture/VentureScheduler';
import { DEFAULT_BUILD_SETTINGS, getBuildSettings, normalizeBuildSettings, updateBuildSettings } from '../src/services/organization/venture/BuildSettings';
import { organizationRoutes } from '../src/api/routes/organization';
import { AdminService } from '../src/services/AdminService';

const TOKEN = 'gitea-secret-token-123';

function seedIdeaAndRepo(status = 'healthy') {
  db.prepare(`INSERT OR REPLACE INTO organization_ideas (id, title, problem_statement, summary, source_signals, strategic_score,
              feasibility_score, novelty_score, overall_score, status, created_at, updated_at)
              VALUES ('idea1', 'Idea', 'p', 's', '[]', 0.9, 0.9, 0.9, 0.9, 'proposed', '', '')`).run();
  db.prepare(`INSERT OR REPLACE INTO organization_repositories (id, repo_name, namespace, gitea_url, created_from_idea_id,
              bootstrap_template, validation_status, created_at)
              VALUES ('repo1', 'idea', 'aimindmesh-labs', 'http://gitea:3000/aimindmesh-labs/idea', 'idea1', 'node-webapp', ?, '')`).run(status);
}

beforeEach(() => {
  vi.stubEnv('GITEA_TOKEN', TOKEN);
  db.prepare(`DELETE FROM system_settings WHERE id = 'organization.build'`).run();
  mocks.runAgentTask.mockReset();
  mocks.characterizeIdea.mockReset();
  mocks.reviewIdea.mockReset();
  seedIdeaAndRepo();
});

describe('build settings', () => {
  it('are off by default and clamp what the panel sends', () => {
    expect(getBuildSettings()).toEqual(DEFAULT_BUILD_SETTINGS);
    expect(DEFAULT_BUILD_SETTINGS.enabled).toBe(false);
    const next = normalizeBuildSettings({ enabled: true, maxAttempts: 999, validationImage: 'node:22; rm -rf /', model: 'gemini-3.1-pro-preview' });
    expect(next).toMatchObject({ enabled: true, maxAttempts: 20, validationImage: DEFAULT_BUILD_SETTINGS.validationImage, model: 'gemini-3.1-pro-preview' });
  });

  it('persist across reads', () => {
    updateBuildSettings({ enabled: true, dailyRunLimit: 2 });
    expect(getBuildSettings()).toMatchObject({ enabled: true, dailyRunLimit: 2 });
    updateBuildSettings({ model: '' });
    expect(getBuildSettings()).toMatchObject({ enabled: true, model: null });
  });
});

describe('kill switch', () => {
  it('starts no development run while builds are disabled', () => {
    expect(VentureScheduler.requestRun('repo1', 'system')).toEqual({ started: false, reason: 'disabled' });
    expect(VentureScheduler.requestRun('repo1', 'human')).toEqual({ started: false, reason: 'disabled' });
    expect(db.prepare(`SELECT active_run_id FROM organization_repositories WHERE id = 'repo1'`).get()).toEqual({ active_run_id: null });
  });

  it('the scheduler tick resumes nothing while builds are disabled', async () => {
    seedIdeaAndRepo('cooldown');
    db.prepare(`UPDATE organization_repositories SET cooldown_until = '2000-01-01T00:00:00Z' WHERE id = 'repo1'`).run();
    await (VentureScheduler as any).tick();
    expect(db.prepare(`SELECT active_run_id, validation_status FROM organization_repositories WHERE id = 'repo1'`).get())
      .toEqual({ active_run_id: null, validation_status: 'cooldown' });
  });
});

describe('CI webhook', () => {
  it('records the CI outcome without touching the venture status', () => {
    seedIdeaAndRepo('blocked');
    VentureOrchestrator.handleCiWebhook({ repository: { name: 'idea' }, workflow_run: { status: 'completed', conclusion: 'success' } });
    const row = db.prepare(`SELECT validation_status, last_ci_status FROM organization_repositories WHERE id = 'repo1'`).get();
    expect(row).toEqual({ validation_status: 'blocked', last_ci_status: 'success' });
  });
});

describe('organization routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    app.register(organizationRoutes, { prefix: '/api/organization' });
    await app.ready();
  });
  afterAll(() => app.close());

  it('a council consensus approves the idea but never characterizes it', async () => {
    mocks.reviewIdea.mockResolvedValue({ consensus: true, synthesis: 'Consensus: Yes', transcript: [] });
    const res = await app.inject({ method: 'POST', url: '/api/organization/ideas/idea1/review', payload: {} });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => expect(db.prepare(`SELECT status FROM organization_ideas WHERE id = 'idea1'`).get()).toEqual({ status: 'approved' }));
    expect(mocks.characterizeIdea).not.toHaveBeenCalled();
  });

  it('approval is the single gate: a second approval or a build in progress answers 409', async () => {
    mocks.characterizeIdea.mockResolvedValue(undefined);
    const first = await app.inject({ method: 'POST', url: '/api/organization/ideas/idea1/approve' });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() => expect(mocks.characterizeIdea).toHaveBeenCalledWith('idea1'));
    db.prepare(`UPDATE organization_ideas SET status = 'development' WHERE id = 'idea1'`).run();
    expect((await app.inject({ method: 'POST', url: '/api/organization/ideas/idea1/approve' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/organization/ideas/idea1/transition' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/organization/ideas/missing/approve' })).statusCode).toBe(404);

    db.prepare(`UPDATE organization_repositories SET active_run_id = 'run-x' WHERE id = 'repo1'`).run();
    expect((await app.inject({ method: 'DELETE', url: '/api/organization/ideas/idea1' })).statusCode).toBe(409);
    db.prepare(`UPDATE organization_repositories SET active_run_id = NULL WHERE id = 'repo1'`).run();
  });

  it('force-develop is refused while builds are disabled', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/organization/repositories/repo1/force-develop' });
    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toBe('disabled');
  });

  it('exposes the build settings', async () => {
    const patched = await app.inject({ method: 'PATCH', url: '/api/organization/build-config', payload: { enabled: true, maxAttempts: 3 } });
    expect(patched.json().config).toMatchObject({ enabled: true, maxAttempts: 3 });
    const read = await app.inject({ method: 'GET', url: '/api/organization/build-config' });
    expect(read.json().config).toMatchObject({ enabled: true, maxAttempts: 3 });
    expect((await app.inject({ method: 'PATCH', url: '/api/organization/build-config', payload: '[1]', headers: { 'content-type': 'application/json' } })).statusCode).toBe(400);
  });
});

describe('admin retry', () => {
  it('refuses venture agent tasks and leaves them out of restore-all', async () => {
    db.prepare(`INSERT INTO inference_queue (id, type, task_name, model, status, payload, created_at)
                VALUES ('t1', 'AGENT_TASK', 'AI Council: idea', 'openclaw', 'FAILED', '{"repoId":"repo1","repoName":"idea"}', 0)`).run();
    expect(await AdminService.retryTask('t1')).toBe(false);
    await AdminService.restoreAllFailedTasks();
    expect(mocks.runAgentTask).not.toHaveBeenCalled();
    expect(db.prepare(`SELECT status FROM inference_queue WHERE id = 't1'`).get()).toEqual({ status: 'FAILED' });
  });
});
