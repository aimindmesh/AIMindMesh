import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: vi.fn() } }));

import { renderSpecMarkdown, validateSpec } from '../src/services/organization/venture/VentureSpec';
import { evaluateMilestone } from '../src/services/organization/venture/milestoneVerdict';
import { canonicalFiles, criterionOfFile, scaffoldFiles } from '../src/services/organization/venture/VentureScaffold';
import type { ValidationReport } from '../src/services/organization/venture/ContainerValidationService';

const validRaw = {
  audience: 'Freelancers',
  problem: 'Invoices take time',
  mvpFeatures: [{ id: 'F1', title: 'Totals', description: 'Sum time entries' }],
  outOfScope: ['Payments'],
  template: 'node-library',
  publicInterface: 'export function total(entries: {hours: number; rate: number}[]): number',
  acceptanceCriteria: [
    { id: 'AC-1', feature: 'F1', given: 'two entries', when: 'total() runs', then: 'it returns the sum' },
    { id: 'AC-2', feature: 'F1', given: 'no entries', when: 'total() runs', then: 'it returns 0' },
  ],
  milestones: [{ id: 'M1', title: 'Core', criteria: ['AC-1'] }, { id: 'M2', title: 'Edge cases', criteria: ['AC-2'] }],
};

describe('venture spec', () => {
  it('accepts a coherent spec and renders it', () => {
    const { spec, errors } = validateSpec(validRaw);
    expect(errors).toEqual([]);
    const md = renderSpecMarkdown('Invoice Snap', spec!);
    expect(md).toContain('### M1 — Core');
    expect(md).toContain('**AC-2** (F1) — Given no entries');
  });

  it('reports every structural problem so the model can fix them', () => {
    const { spec, errors } = validateSpec({
      ...validRaw,
      publicInterface: '',
      acceptanceCriteria: [...validRaw.acceptanceCriteria, { id: 'X9', feature: 'F1', given: 'g', when: 'w', then: '' }],
      milestones: [{ id: 'M1', title: 'Core', criteria: ['AC-1', 'AC-1', 'AC-7'] }],
    });
    expect(spec).toBeUndefined();
    expect(errors).toEqual(expect.arrayContaining([
      'publicInterface must describe the functions or routes the tests will use',
      'criterion id "X9" must look like AC-1',
      'X9 needs given, when and then',
      'milestone M1 refers to unknown criterion AC-7',
      'AC-1 is in both M1 and M1',
      'AC-2 belongs to no milestone',
    ]));
  });

  it('falls back to the library template for an unknown one', () => {
    expect(validateSpec({ ...validRaw, template: 'rails-app' }).spec!.template).toBe('node-library');
  });
});

const report = (files: { file: string; status: 'passed' | 'failed'; passed: number; failed: number }[], failedStep?: string): ValidationReport => ({
  status: files.every(f => f.status === 'passed') ? 'passed' : 'failed',
  summary: 'x',
  steps: failedStep ? [{ name: failedStep, ok: false, durationMs: 1, output: 'boom' }] : [{ name: 'test', ok: false, durationMs: 1, output: '' }],
  tests: { runner: 'vitest', total: 0, passed: 0, failed: 0, failures: [], passedNames: [], files },
});

describe('milestone verdict', () => {
  const own = { file: 'test/smoke.test.ts', status: 'passed' as const, passed: 1, failed: 0 };
  it('needs the required criteria and the agent tests, not the later ones', () => {
    const verdict = evaluateMilestone(report([
      own,
      { file: 'acceptance/AC-1.test.ts', status: 'passed', passed: 2, failed: 0 },
      { file: 'acceptance/AC-2.test.ts', status: 'failed', passed: 0, failed: 1 },
    ]), ['AC-1']);
    expect(verdict).toMatchObject({ ok: true, passed: ['AC-1'], missing: [] });
  });

  it('fails on a missing criterion, a broken agent test or a blocking step', () => {
    expect(evaluateMilestone(report([own, { file: 'acceptance/AC-1.test.ts', status: 'failed', passed: 0, failed: 1 }]), ['AC-1']))
      .toMatchObject({ ok: false, missing: ['AC-1'] });
    expect(evaluateMilestone(report([{ ...own, status: 'failed' }, { file: 'acceptance/AC-1.test.ts', status: 'passed', passed: 1, failed: 0 }]), ['AC-1']).summary)
      .toMatch(/Project tests failing/);
    expect(evaluateMilestone(report([own], 'build'), []).ok).toBe(false);
    expect(criterionOfFile('/tmp/w/acceptance/AC-12.test.ts')).toBe('AC-12');
    expect(criterionOfFile('test/AC-1.test.ts')).toBeNull();
  });
});

// The templates must build and pass their smoke test as scaffolded: checked with the server's own
// typescript and vitest (no download)
describe.each(['node-library', 'node-api'] as const)('template %s', template => {
  it('builds and passes its smoke test', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `venture-tpl-${template}-`));
    try {
      const files = { ...scaffoldFiles(template, 'demo-venture', 'Demo Venture'), ...canonicalFiles(template, {}) };
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
      expect(files['package.json']).toContain('"name": "demo-venture"');
      fs.symlinkSync(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');
      execFileSync(path.resolve('node_modules/.bin/tsc'), ['-p', 'tsconfig.json', '--noEmit'], { cwd: dir, stdio: 'pipe' });
      const out = execFileSync(path.resolve('node_modules/.bin/vitest'), ['run', '--reporter=json'], { cwd: dir, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, VITEST: undefined } });
      const json = JSON.parse(out.slice(out.indexOf('{')));
      expect(json.numFailedTests).toBe(0);
      expect(json.numPassedTests).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
