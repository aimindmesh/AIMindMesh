import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from './fixtures/config';
import { runRelatedTests } from '../src/services/evolution/PatchTestRunner';

// Real `vitest related` on a private copy of the server: the patched file must keep its tests green
const TIMEOUT = 240_000;
const target = 'aimindmesh-server/src/services/organization/venture/milestoneVerdict.ts';
const original = fs.readFileSync(path.join(SERVER_ROOT, 'src/services/organization/venture/milestoneVerdict.ts'), 'utf-8');

describe('related tests of a patch', () => {
  it('pass for a harmless change and fail when the patch breaks behaviour', async () => {
    const ok = await runRelatedTests(SERVER_ROOT, [{ path: target, content: `${original}\nexport const harmless = 1;\n` }], TIMEOUT);
    expect(ok.status).toBe('passed');

    // the verdict now approves anything: test/ventureSpec.test.ts must catch it
    const broken = original.replace('return { ok: true,', 'return { ok: true, _: 0,').replace(/if \(missing\.length > 0\) \{[\s\S]*?\n  \}\n/, '');
    const bad = await runRelatedTests(SERVER_ROOT, [{ path: target, content: broken }], TIMEOUT);
    expect(bad.status).toBe('failed');
    expect(bad.errors.join('\n')).toContain('ventureSpec.test.ts');
  }, TIMEOUT * 4);

  it('skips patches without server sources', async () => {
    expect((await runRelatedTests(SERVER_ROOT, [{ path: 'aimindmesh-mobile/src/App.tsx', content: 'x' }], 1000)).status).toBe('skipped');
  });
});
