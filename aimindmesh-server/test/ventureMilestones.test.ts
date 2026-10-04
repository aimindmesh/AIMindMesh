import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import db from '../src/db/sqlite';

vi.mock('../src/db/neo4j', () => ({ getSession: () => ({ run: async () => ({ records: [] }), close: async () => {} }) }));
vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn(), getSessionHistory: vi.fn(async () => []) }));
vi.mock('../src/services/InferenceRouter', async importOriginal => ({ ...(await importOriginal<any>()) }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn(async () => {}) }));

import { VentureScheduler } from '../src/services/organization/venture/VentureScheduler';
import { updateBuildSettings } from '../src/services/organization/venture/BuildSettings';
import { createMilestones, listMilestones } from '../src/services/organization/venture/Milestones';
import { DesignOrchestrator } from '../src/services/organization/DesignOrchestrator';
import { organizationRoutes } from '../src/api/routes/organization';
import type { AgentRunner } from '../src/services/organization/venture/VentureBuildRun';
import type { ContainerValidationService, ValidationReport } from '../src/services/organization/venture/ContainerValidationService';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });

let tmp: string;
let remote: string;
let passing: string[] = [];

const spec = {
  audience: 'a', problem: 'p', mvpFeatures: [{ id: 'F1', title: 'f', description: 'd' }], outOfScope: [],
  template: 'node-library', publicInterface: 'export function total(): number',
  acceptanceCriteria: [
    { id: 'AC-1', feature: 'F1', given: 'g', when: 'w', then: 't' },
    { id: 'AC-2', feature: 'F1', given: 'g', when: 'w', then: 't' },
  ],
  milestones: [{ id: 'M1', title: 'Core', criteria: ['AC-1'] }, { id: 'M2', title: 'More', criteria: ['AC-2'] }],
};
const acceptance = { 'acceptance/AC-1.test.ts': '// canonical AC-1\n', 'acceptance/AC-2.test.ts': '// canonical AC-2\n' };

// The agent implements something and tries to weaken the acceptance test
const agent: AgentRunner = {
  async run(_prompt, sessionKey) {
    const dir = path.join(process.env.VENTURE_WORKSPACES_DIR!, sessionKey.replace(/^develop-/, ''));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', `feature-${Date.now()}.ts`), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'acceptance', 'AC-1.test.ts'), '// weakened\n');
    return { status: 'ok', reply: 'done' };
  },
};

const validator = {
  async validate(): Promise<ValidationReport> {
    const files = [
      { file: 'test/smoke.test.ts', status: 'passed' as const, passed: 1, failed: 0 },
      ...['AC-1', 'AC-2'].map(id => passing.includes(id)
        ? { file: `acceptance/${id}.test.ts`, status: 'passed' as const, passed: 1, failed: 0 }
        : { file: `acceptance/${id}.test.ts`, status: 'failed' as const, passed: 0, failed: 1 }),
    ];
    const ok = files.every(f => f.status === 'passed');
    return {
      status: ok ? 'passed' : 'failed', summary: 'tests ran',
      steps: [{ name: 'test', ok, durationMs: 1, output: '' }],
      tests: { runner: 'vitest', total: 3, passed: files.filter(f => f.status === 'passed').length, failed: files.filter(f => f.status === 'failed').length, failures: [], passedNames: [], files },
    };
  },
  async sweep() { return 0; },
} as unknown as ContainerValidationService;

function seed() {
  db.prepare('DELETE FROM organization_repositories').run();
  db.prepare('DELETE FROM organization_venture_milestones').run();
  db.prepare('DELETE FROM organization_product_designs').run();
  db.prepare('DELETE FROM organization_ideas').run();
  db.prepare(`DELETE FROM organization_audit_log WHERE event_type LIKE 'venture:%'`).run();
  fs.rmSync(path.join(tmp, 'git'), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, 'work'), { recursive: true, force: true });

  remote = path.join(tmp, `remote-${Date.now()}.git`);
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const seedDir = path.join(tmp, `seed-${Date.now()}`);
  git(tmp, 'clone', '--quiet', remote, seedDir);
  fs.writeFileSync(path.join(seedDir, 'TECHNICAL_SPECIFICATION.md'), '# spec\n');
  git(seedDir, 'add', '-A');
  git(seedDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'spec');
  git(seedDir, 'push', '--quiet', 'origin', 'HEAD:main');

  db.prepare(`INSERT INTO organization_ideas (id, title, problem_statement, summary, source_signals, strategic_score, feasibility_score,
              novelty_score, overall_score, status, created_at, updated_at) VALUES ('idea-1', 'Invoice Snap', 'p', 's', '[]', 1, 1, 1, 1, 'characterized', 'n', 'n')`).run();
  db.prepare(`INSERT INTO organization_product_designs (id, idea_id, scope_and_audience, ui_ux_design, core_logic, tech_stack, raw_markdown, spec_json, acceptance_json, created_at, updated_at)
              VALUES ('d1', 'idea-1', 'a', 'i', 'c', 'node-library', '# spec', ?, ?, 'n', 'n')`).run(JSON.stringify(spec), JSON.stringify(acceptance));
  createMilestones('idea-1', spec.milestones);
  db.prepare(`INSERT INTO organization_repositories (id, repo_name, namespace, gitea_url, created_from_idea_id, bootstrap_template, validation_status, created_at)
              VALUES ('r1', 'invoice-snap', 'labs', ?, 'idea-1', 'node-library', 'pending', 'n')`).run(`file://${remote}`);
}

const row = () => db.prepare(`SELECT validation_status, active_run_id, last_validation FROM organization_repositories WHERE id = 'r1'`).get() as any;
const ideaStatus = () => (db.prepare(`SELECT status FROM organization_ideas WHERE id = 'idea-1'`).get() as any).status;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venture-ms-'));
  VentureScheduler.configure({ agent, validator });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv('VENTURE_GIT_DIR', path.join(tmp, 'git'));
  vi.stubEnv('VENTURE_WORKSPACES_DIR', path.join(tmp, 'work'));
  updateBuildSettings({ enabled: true, maxAttempts: 3, dailyRunLimit: 20, maxConcurrentBuilds: 1, maxRunsPerVenture: 10 });
  seed();
});

describe('venture milestones', () => {
  it('scaffolds, builds milestone by milestone and stops at the MVP; the acceptance tests stay the platform\'s', async () => {
    passing = ['AC-1'];
    expect(VentureScheduler.requestRun('r1', 'system').started).toBe(true);
    // milestone 1 done: back to pending, the next run starts by itself and fails on AC-2
    await vi.waitFor(() => expect(row()).toMatchObject({ validation_status: 'cooldown', active_run_id: null }), { timeout: 10_000 });
    expect(listMilestones('idea-1').map(m => m.status)).toEqual(['done', 'in_progress']);
    expect(ideaStatus()).toBe('development');

    passing = ['AC-1', 'AC-2'];
    expect(VentureScheduler.requestRun('r1', 'system').started).toBe(true);
    await vi.waitFor(() => expect(row()).toMatchObject({ validation_status: 'healthy', active_run_id: null }), { timeout: 10_000 });
    expect(listMilestones('idea-1').map(m => m.status)).toEqual(['done', 'done']);
    expect(ideaStatus()).toBe('mvp_ready');

    const tree = git(tmp, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main');
    expect(tree).toContain('package.json');
    expect(tree).toContain('vitest.config.ts');
    expect(git(tmp, '--git-dir', remote, 'show', 'main:acceptance/AC-1.test.ts')).toBe('// canonical AC-1\n');
    expect(JSON.parse(row().last_validation).discarded).toContain('acceptance/AC-1.test.ts');
  });

  describe('decisions on the MVP', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = Fastify();
      app.register(organizationRoutes, { prefix: '/api/organization' });
      await app.ready();
    });
    afterAll(() => app.close());
    const decide = (decision: string, notes = 'notes') =>
      app.inject({ method: 'POST', url: '/api/organization/ideas/idea-1/decision', payload: { decision, notes } });

    it('continue adds milestones and resumes the builds', async () => {
      db.prepare(`UPDATE organization_ideas SET status = 'mvp_ready' WHERE id = 'idea-1'`).run();
      db.prepare(`UPDATE organization_venture_milestones SET status = 'done'`).run();
      const extend = vi.spyOn(DesignOrchestrator, 'extendSpec').mockImplementation(async () => {
        createMilestones('idea-1', [{ id: 'M3', title: 'Exports', criteria: ['AC-3'] }]);
      });
      passing = [];
      expect((await decide('continue', 'add CSV export')).statusCode).toBe(202);
      await vi.waitFor(() => expect(ideaStatus()).toBe('development'));
      expect(extend).toHaveBeenCalledWith('idea-1', 'add CSV export');
      expect(listMilestones('idea-1').map(m => m.title)).toEqual(['Core', 'More', 'Exports']);
      await vi.waitFor(() => expect(row().active_run_id).toBeNull(), { timeout: 10_000 });
    });

    it('kill closes the venture and pivot sends it back to approval without its spec', async () => {
      expect((await decide('continue')).statusCode).toBe(409); // not ready
      expect((await decide('kill', 'nobody needs it')).statusCode).toBe(202);
      expect(ideaStatus()).toBe('killed');
      expect(row().validation_status).toBe('blocked');

      seed();
      db.prepare(`UPDATE organization_ideas SET status = 'mvp_ready' WHERE id = 'idea-1'`).run();
      expect((await decide('pivot', 'target accountants instead')).statusCode).toBe(202);
      expect(ideaStatus()).toBe('approved');
      expect(db.prepare(`SELECT COUNT(*) AS c FROM organization_product_designs WHERE idea_id = 'idea-1'`).get()).toEqual({ c: 0 });
      expect(listMilestones('idea-1')).toEqual([]);
      expect((await decide('maybe')).statusCode).toBe(400);
    });
  });
});
