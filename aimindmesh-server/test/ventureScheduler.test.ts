import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../src/db/sqlite';

vi.mock('../src/db/neo4j', () => ({ getSession: () => ({ run: async () => ({ records: [] }), close: async () => {} }) }));
vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), getSessionHistory: vi.fn(async () => []) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn(async () => {}) }));

import { VentureScheduler } from '../src/services/organization/venture/VentureScheduler';
import { updateBuildSettings } from '../src/services/organization/venture/BuildSettings';
import type { AgentRunner } from '../src/services/organization/venture/VentureBuildRun';
import type { ContainerValidationService, ValidationReport } from '../src/services/organization/venture/ContainerValidationService';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });

let tmp: string;
const prompts: string[] = [];
let agentWrites = true;
let gate: Promise<void> = Promise.resolve();
let validation: ValidationReport['status'] = 'passed';

const agent: AgentRunner = {
  async run(prompt, sessionKey) {
    prompts.push(prompt);
    await gate;
    if (agentWrites) {
      const dir = path.join(process.env.VENTURE_WORKSPACES_DIR!, sessionKey.replace(/^develop-/, ''));
      fs.writeFileSync(path.join(dir, `file-${prompts.length}.js`), 'module.exports = 1;\n');
    }
    return { status: 'ok', reply: 'done' };
  },
};

const validator = {
  async validate(): Promise<ValidationReport> {
    return validation === 'passed'
      ? { status: 'passed', summary: 'Build ok, 2/2 tests passed', steps: [] }
      : { status: 'failed', summary: '1 of 2 tests failed', steps: [{ name: 'test', ok: false, durationMs: 1, output: 'AssertionError' }], tests: { runner: 'vitest', total: 2, passed: 1, failed: 1, failures: ['adds'], passedNames: [], files: [] } };
  },
  async sweep() { return 0; },
} as unknown as ContainerValidationService;

function makeRemote(name: string): string {
  const remote = path.join(tmp, `${name}.git`);
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const seed = path.join(tmp, `seed-${name}`);
  git(tmp, 'clone', '--quiet', remote, seed);
  fs.writeFileSync(path.join(seed, 'TECHNICAL_SPECIFICATION.md'), '# spec\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'spec');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  return remote;
}

function seedRepo(id: string, name: string, status = 'pending') {
  const remote = makeRemote(name);
  db.prepare(`INSERT OR REPLACE INTO organization_ideas (id, title, problem_statement, summary, source_signals, strategic_score,
              feasibility_score, novelty_score, overall_score, status, created_at, updated_at)
              VALUES (?, 'Idea', 'p', 's', '[]', 0.9, 0.9, 0.9, 0.9, 'approved', '', '')`).run(`idea-${id}`);
  db.prepare(`INSERT OR REPLACE INTO organization_repositories (id, repo_name, namespace, gitea_url, created_from_idea_id,
              bootstrap_template, validation_status, retry_count, created_at)
              VALUES (?, ?, 'labs', ?, ?, 'node-webapp', ?, 0, '')`).run(id, name, `file://${remote}`, `idea-${id}`, status);
  return remote;
}

const repoRow = (id: string) => db.prepare(`SELECT validation_status, retry_count, blocked_reason, active_run_id FROM organization_repositories WHERE id = ?`).get(id) as any;
const settled = (id: string) => vi.waitFor(() => expect(repoRow(id).active_run_id).toBeNull(), { timeout: 10_000 });

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venture-sched-'));
  VentureScheduler.configure({ agent, validator });
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  // unstubEnvs runs after every test: stub per test
  vi.stubEnv('VENTURE_GIT_DIR', path.join(tmp, 'git'));
  vi.stubEnv('VENTURE_WORKSPACES_DIR', path.join(tmp, 'work'));
  vi.stubEnv('GITEA_TOKEN', 'gitea-secret-token-123');
  db.prepare('DELETE FROM organization_repositories').run();
  db.prepare(`DELETE FROM organization_audit_log WHERE event_type LIKE 'venture:%'`).run();
  prompts.length = 0;
  agentWrites = true;
  gate = Promise.resolve();
  validation = 'passed';
  updateBuildSettings({ enabled: true, maxAttempts: 2, dailyRunLimit: 10, maxConcurrentBuilds: 1 });
});

describe('venture scheduler', () => {
  it('publishes a validated run and never shows the agent a credential', async () => {
    const remote = seedRepo('r1', 'alpha');
    const result = VentureScheduler.requestRun('r1', 'system');
    expect(result.started).toBe(true);
    await settled('r1');

    expect(repoRow('r1')).toMatchObject({ validation_status: 'healthy', retry_count: 0 });
    expect(git(tmp, '--git-dir', remote, 'ls-tree', '--name-only', 'main')).toContain('file-1.js');
    expect(db.prepare(`SELECT status FROM organization_ideas WHERE id = 'idea-r1'`).get()).toEqual({ status: 'development' });
    expect(prompts[0]).toContain('ventures/alpha');
    expect(prompts[0]).not.toContain('gitea-secret-token-123');
    expect(prompts[0]).not.toMatch(/https?:\/\/|file:\/\//);
  });

  it('spends attempts on failures, blocks at the budget and never pushes a failed run', async () => {
    const remote = seedRepo('r1', 'beta');
    validation = 'failed';

    VentureScheduler.requestRun('r1', 'system');
    await settled('r1');
    expect(repoRow('r1')).toMatchObject({ validation_status: 'cooldown', retry_count: 1 });
    expect(prompts).toHaveLength(1);

    VentureScheduler.requestRun('r1', 'system');
    await settled('r1');
    expect(repoRow('r1')).toMatchObject({ validation_status: 'blocked', retry_count: 2 });
    expect(repoRow('r1').blocked_reason).toMatch(/2 failed attempts/);
    // the second prompt carries the failure of the first validation
    expect(prompts[1]).toContain('The last validation FAILED');
    expect(git(tmp, '--git-dir', remote, 'ls-tree', '--name-only', 'main').trim()).toBe('TECHNICAL_SPECIFICATION.md');

    expect(VentureScheduler.requestRun('r1', 'system')).toEqual({ started: false, reason: 'blocked' });
    validation = 'passed';
    expect(VentureScheduler.requestRun('r1', 'human').started).toBe(true);
    await settled('r1');
    expect(repoRow('r1')).toMatchObject({ validation_status: 'healthy', retry_count: 0, blocked_reason: null });
  });

  it('counts a run that changed nothing as a failed attempt', async () => {
    seedRepo('r1', 'gamma');
    agentWrites = false;
    VentureScheduler.requestRun('r1', 'system');
    await settled('r1');
    expect(repoRow('r1')).toMatchObject({ validation_status: 'cooldown', retry_count: 1 });
  });

  it('holds one run per repository and respects the concurrency and daily limits', async () => {
    seedRepo('r1', 'delta');
    seedRepo('r2', 'epsilon');
    let release!: () => void;
    gate = new Promise(resolve => { release = resolve; });

    expect(VentureScheduler.requestRun('r1', 'system').started).toBe(true);
    expect(VentureScheduler.requestRun('r1', 'human')).toEqual({ started: false, reason: 'busy' });
    expect(VentureScheduler.requestRun('r2', 'system')).toEqual({ started: false, reason: 'busy' });
    release();
    await settled('r1');

    updateBuildSettings({ dailyRunLimit: 1 });
    expect(VentureScheduler.requestRun('r2', 'system')).toEqual({ started: false, reason: 'daily_limit' });
  });

  it('closes runs interrupted by a restart as a failed attempt', async () => {
    seedRepo('r1', 'zeta', 'evolving');
    db.prepare(`UPDATE organization_repositories SET active_run_id = 'lost-run' WHERE id = 'r1'`).run();
    await (VentureScheduler as any).reconcile();
    expect(repoRow('r1')).toMatchObject({ active_run_id: null, validation_status: 'cooldown', retry_count: 1 });
  });
});
