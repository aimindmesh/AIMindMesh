import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from './fixtures/config';
import { ValidationLayer } from '../src/services/ValidationLayer';

// Real tsc runs on a temp copy of src/ (two passes when the patch fails): give them time
const TSC_TIMEOUT = 180_000;

const validator = new ValidationLayer();
const target = 'aimindmesh-server/src/services/WikiManager.ts';
const original = fs.readFileSync(path.join(SERVER_ROOT, 'src/services/WikiManager.ts'), 'utf-8');
const out = (extra: Record<string, unknown>) =>
  ({ explanation: '', estimatedImpact: 'low', breakingChange: false, skip: false, modifiedFileContent: original + '\n', ...extra }) as any;
// originalContent null = no original file (an explicit undefined would pick the default)
const validate = (output: any, repository = 'AIMindMesh', file = target, originalContent: string | null = original) =>
  validator.validate(file, output, originalContent ?? undefined, { repository });

describe('ValidationLayer type-checks the patch itself', () => {
  it('passes a valid change', async () => {
    const res = await validate(out({ modifiedFileContent: original + '\nexport function harnessOk(): number { return 1; }\n' }));
    expect(res.errors).toEqual([]);
    expect(res.passed).toBe(true);
  }, TSC_TIMEOUT);

  it('blocks a type error in the target', async () => {
    const res = await validate(out({ modifiedFileContent: original + '\nexport const harnessBad: number = "not a number";\n' }));
    expect(res.passed).toBe(false);
    expect(res.errors.join('\n')).toContain('TS2322');
  }, TSC_TIMEOUT);

  it('blocks a type error in an additional file', async () => {
    const res = await validate(out({
      additionalFiles: [{ path: 'aimindmesh-server/src/services/FeedManager.ts', content: 'export const broken: string = 42;\n', reason: '' }],
    }));
    expect(res.passed).toBe(false);
    expect(res.errors.join('\n')).toContain('FeedManager');
  }, TSC_TIMEOUT);

  it('blocks a generated test that would break the build', async () => {
    const res = await validate(out({
      unitTestPath: 'src/services/__tests__/wiki.test.ts',
      unitTestContent: `import { describe } from '@jest/globals';\ndescribe('x', () => {});\n`,
    }));
    expect(res.passed).toBe(false);
  }, TSC_TIMEOUT);

  it('only warns about missing modules of newly introduced dependencies', async () => {
    const res = await validate(out({ modifiedFileContent: `import leftPad from 'left-pad-harness';\n${original}\nexport const harnessPad = leftPad;\n` }));
    expect(res.passed).toBe(true);
    expect(res.warnings.join('\n')).toContain('left-pad-harness');
  }, TSC_TIMEOUT);

  it('skips (with a warning) files it cannot type-check', async () => {
    const res = await validate(out({ modifiedFileContent: 'x'.repeat(120) + ';' }), 'my-app', 'src/index.ts', null);
    expect(res.passed).toBe(true);
    expect(res.warnings.join('\n')).toContain('not type-checked');
  });

  it('cleans up its temporary copies', () => {
    expect(fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('autoevo-tsc-'))).toEqual([]);
  });
});
