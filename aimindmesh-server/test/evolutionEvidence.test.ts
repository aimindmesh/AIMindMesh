import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../src/db/sqlite';
import { SERVER_ROOT } from './fixtures/config';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), neo4j: vi.fn() }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: mocks.complete, onTaskCompleted: vi.fn() } }));
vi.mock('../src/db/neo4j', () => ({ getSession: mocks.neo4j }));

import { collectInferenceFailures, collectRuntimeErrors, isOperational, normalizeMessage, severityOf } from '../src/services/evolution/signals/RuntimeSignals';
import { detectSignalCandidates, signalCandidateId } from '../src/services/evolution/signals/SignalCandidates';
import { applyEdits } from '../src/services/evolution/EditApplier';
import { ImprovementDetector } from '../src/services/ImprovementDetector';
import { CodeGenerationTask } from '../src/services/CodeGenerationTask';

const DAY = 86_400_000;
const options = { sinceMs: Date.now() - 7 * DAY, minOccurrences: 5, minDays: 2, limit: 20 };

function logError(module: string, message: string, ageMs: number) {
  db.prepare(`INSERT INTO system_logs (id, level, module, message, timestamp) VALUES (?, 'ERROR', ?, ?, ?)`)
    .run(`log-${Math.random()}`, module, message, Date.now() - ageMs);
}

beforeEach(() => {
  db.prepare('DELETE FROM system_logs').run();
  db.prepare('DELETE FROM inference_queue').run();
  db.prepare('DELETE FROM evolution_candidates').run();
  mocks.complete.mockReset();
  mocks.neo4j.mockReset();
});

describe('runtime signals', () => {
  it('groups recurring errors by normalized message and maps them to their file', () => {
    for (let i = 0; i < 6; i++) logError('WikiManager', `Failed to load page "page-${i}" (id 3f2a9c1e7b): Cannot read properties of undefined`, (i % 2) * DAY + i * 1000);
    logError('WikiManager', 'Request timed out after 30000 ms', 1000); // operational: ignored
    logError('WikiManager', 'Rare one-off failure', 1000);              // below the threshold

    const [signal, ...rest] = collectRuntimeErrors(options);
    expect(rest).toEqual([]);
    expect(signal).toMatchObject({ kind: 'runtime_error', module: 'WikiManager', count: 6, days: 2, target: 'aimindmesh-server/src/services/WikiManager.ts' });
    expect(signal.pattern).toBe('Failed to load page <str> (id <hex>): Cannot read properties of undefined');
    expect(severityOf(signal)).toBeGreaterThanOrEqual(6);
  });

  it('groups failing inference tasks and leaves environment failures out', () => {
    const insert = db.prepare(`INSERT INTO inference_queue (id, type, task_name, status, payload, error_msg, created_at) VALUES (?, 'WIKI_SYNTHESIS', 't', 'FAILED', '{}', ?, ?)`);
    for (let i = 0; i < 5; i++) insert.run(`q${i}`, `TypeError: x.map is not a function at step ${i}`, Date.now() - (i % 2) * DAY);
    insert.run('q9', 'ETIMEDOUT', Date.now());
    const signals = collectInferenceFailures(options);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: 'inference_failure', module: 'WIKI_SYNTHESIS', count: 5 });
    expect(isOperational('Zombie task: execution context lost')).toBe(true);
    expect(normalizeMessage('Task [a1b2c3d4] failed after 3 retries')).toBe('Task [<hex>] failed after <n> retries');
  });

  it('turns a signal into one candidate with a deterministic id, and never twice', async () => {
    for (let i = 0; i < 5; i++) logError('WikiManager', 'Cannot read properties of undefined (reading slug)', (i % 2) * DAY);
    mocks.complete.mockResolvedValue(JSON.stringify({ title: 'Guard missing page slug', description: 'slug undefined', proposedApproach: 'check it' }));

    const persist = (c: any) => db.prepare(`INSERT INTO evolution_candidates (id, source, source_id, title, description, target_component, created_at)
                                             VALUES (?, ?, ?, ?, ?, ?, 0)`).run(c.id, c.source, c.sourceId, c.title, c.description, c.targetComponent);
    const [candidate] = await detectSignalCandidates(() => [], persist);
    expect(candidate).toMatchObject({ source: 'runtime_error', targetComponent: 'aimindmesh-server/src/services/WikiManager.ts', confidence: 0.9 });
    expect(candidate.id).toBe(signalCandidateId({ kind: 'runtime_error', fingerprint: candidate.sourceId }));
    expect(candidate.description).toContain('5 occurrences over 2 day(s)');

    expect(await detectSignalCandidates(() => [])).toEqual([]);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('the detector reads no knowledge-graph insight unless enabled', async () => {
    await new ImprovementDetector().detectCandidates();
    expect(mocks.neo4j).not.toHaveBeenCalled();
  });
});

describe('edit-based generation output', () => {
  const target = 'aimindmesh-server/src/services/FeedManager.ts';
  const current = fs.readFileSync(path.join(SERVER_ROOT, 'src/services/FeedManager.ts'), 'utf-8');
  const firstLine = current.split('\n')[0];

  it('applies unique edits and refuses ambiguous or missing ones', () => {
    const files = { 'a.ts': 'const x = 1;\nconst y = 1;\n' };
    expect(applyEdits(files, [{ path: 'a.ts', search: 'const x = 1;', replace: 'const x = 2;' }])).toMatchObject({ ok: true, files: { 'a.ts': 'const x = 2;\nconst y = 1;\n' } });
    expect(applyEdits(files, [{ path: 'a.ts', search: '= 1;', replace: '= 2;' }])).toMatchObject({ ok: false, error: expect.stringContaining('found 2 times') });
    expect(applyEdits(files, [{ path: 'a.ts', search: 'nope', replace: '' }])).toMatchObject({ ok: false, error: expect.stringContaining('found 0 times') });
    expect(applyEdits(files, [{ path: 'b.ts', search: 'x', replace: '' }])).toMatchObject({ ok: false, error: expect.stringContaining('unknown file') });
    expect(applyEdits({ 'a.ts': 'v = $1' }, [{ path: 'a.ts', search: 'v = $1', replace: 'v = $&$$' }])).toMatchObject({ files: { 'a.ts': 'v = $&$$' } });
  });

  it('turns edits into the full content of the target, read from the checkout', async () => {
    const output = await new CodeGenerationTask().parseOutput(JSON.stringify({
      explanation: 'tweak', estimatedImpact: 'low', breakingChange: false, skip: false,
      edits: [{ path: target, search: firstLine, replace: `${firstLine}\n// harness edit` }],
      newFiles: [{ path: 'aimindmesh-server/src/services/feedHarness.ts', content: 'export const h = 1;\n', reason: 'helper' }],
    }), { targetComponent: target, repository: 'AIMindMesh' });
    expect(output.modifiedFileContent).toBe(current.replace(firstLine, `${firstLine}\n// harness edit`));
    expect(output.additionalFiles).toEqual([{ path: 'aimindmesh-server/src/services/feedHarness.ts', content: 'export const h = 1;\n', reason: 'helper' }]);
    expect((output as any).edits).toBeUndefined();

    await expect(new CodeGenerationTask().parseOutput(JSON.stringify({ edits: [{ path: target, search: 'not in the file at all', replace: '' }] }), { targetComponent: target }))
      .rejects.toThrow(/found 0 times/);
  });
});

describe('evolution stats', () => {
  it('counts what every source turned into', async () => {
    const Fastify = (await import('fastify')).default;
    const evolutionRoutes = (await import('../src/api/routes/evolution')).default;
    const app = Fastify();
    app.register(evolutionRoutes, { prefix: '/api/evolution' });
    await app.ready();
    const cand = db.prepare(`INSERT INTO evolution_candidates (id, source, source_id, title, description, target_component, status, created_at) VALUES (?, ?, ?, ?, 'd', 'x', ?, 0)`);
    cand.run('c1', 'runtime_error', 's1', 't1', 'proposed');
    cand.run('c2', 'runtime_error', 's2', 't2', 'failed');
    cand.run('c3', 'open_question', 's3', 't3', 'rejected');
    db.prepare(`INSERT INTO evolution_proposals (id, candidate_id, title, explanation, branch_name, pr_url, pr_number, target_component, created_at, status)
                VALUES ('p1', 'c1', 't', 'e', 'b', 'u', 1, 'x', 0, 'merged')`).run();

    const res = await app.inject({ method: 'GET', url: '/api/evolution/stats' });
    expect(res.json().sources).toEqual([
      { source: 'runtime_error', candidates: 2, failed: 1, skipped: 0, proposals: 1, merged: 1, rejected: 0 },
      { source: 'open_question', candidates: 1, failed: 0, skipped: 1, proposals: 0, merged: 0, rejected: 0 },
    ]);
    await app.close();
  });
});
