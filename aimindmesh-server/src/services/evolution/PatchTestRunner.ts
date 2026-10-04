import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PatchFile, serialized, serverSourcePath } from './PatchTypeChecker';

const execFileAsync = promisify(execFile);

export interface RelatedTestsResult {
  /** unavailable: the checkout has no tests or no vitest (e.g. an image built without them) */
  status: 'passed' | 'failed' | 'skipped' | 'unavailable';
  errors: string[];
}

const COPY = ['src', 'test', 'templates', 'vitest.config.mts', 'tsconfig.json', 'tsconfig.test.json', 'package.json'];

/** Env of the child vitest: no variable of a vitest run we may be inside of. */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV' && key !== 'TEST'));
}

async function runVitest(bin: string, cwd: string, files: string[], timeoutMs: number): Promise<{ failed: string[] } | null> {
  const report = path.join(cwd, 'related-report.json');
  await fs.promises.rm(report, { force: true });
  try {
    await execFileAsync(bin, ['related', ...files, '--run', '--passWithNoTests', '--reporter=json', `--outputFile=${report}`], {
      cwd, timeout: timeoutMs, env: childEnv(), maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    // failing tests exit non-zero: the report says which
  }
  try {
    const json = JSON.parse(await fs.promises.readFile(report, 'utf-8'));
    const failed: string[] = [];
    for (const file of json.testResults ?? []) {
      const name = path.relative(cwd, String(file.name ?? ''));
      const assertions: any[] = file.assertionResults ?? [];
      const bad = assertions.filter(a => a.status === 'failed');
      if (bad.length) failed.push(...bad.map(a => `${name} > ${a.fullName ?? a.title}`));
      else if (file.status === 'failed') failed.push(`${name} (failed to run)`);
    }
    return { failed };
  } catch {
    return null; // timeout or crash: no report
  }
}

/**
 * Runs the server tests that import the patched files (`vitest related`) on a private copy of
 * the checkout, like the type check. Failures that also happen without the patch are not
 * blamed on it.
 */
export function runRelatedTests(repoPath: string, files: PatchFile[], timeoutMs: number): Promise<RelatedTestsResult> {
  const overlay = files
    .map(f => ({ local: serverSourcePath(f.path), content: f.content }))
    .filter((f): f is { local: string; content: string } => f.local !== null && typeof f.content === 'string');
  if (overlay.length === 0) return Promise.resolve({ status: 'skipped', errors: [] });

  const bin = path.join(repoPath, 'node_modules', '.bin', 'vitest');
  if (!fs.existsSync(bin) || !fs.existsSync(path.join(repoPath, 'test')) || !fs.existsSync(path.join(repoPath, 'vitest.config.mts'))) {
    return Promise.resolve({ status: 'unavailable', errors: ['The checkout has no server tests or no vitest'] });
  }

  return serialized(async (): Promise<RelatedTestsResult> => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'autoevo-test-'));
    try {
      for (const entry of COPY) {
        const from = path.join(repoPath, entry);
        if (fs.existsSync(from)) await fs.promises.cp(from, path.join(tmp, entry), { recursive: true });
      }
      await fs.promises.symlink(path.join(repoPath, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');

      const originals = new Map<string, string | null>();
      for (const file of overlay) {
        const dest = path.join(tmp, file.local);
        if (!dest.startsWith(tmp + path.sep)) continue;
        originals.set(dest, fs.existsSync(dest) ? await fs.promises.readFile(dest, 'utf-8') : null);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, file.content);
      }

      const targets = overlay.map(f => f.local);
      const patched = await runVitest(bin, tmp, targets, timeoutMs);
      if (!patched) return { status: 'failed', errors: ['Related tests did not complete (timeout or crash)'] };
      if (patched.failed.length === 0) return { status: 'passed', errors: [] };

      for (const [dest, original] of originals) {
        if (original === null) await fs.promises.rm(dest, { force: true });
        else await fs.promises.writeFile(dest, original);
      }
      const baseline = new Set((await runVitest(bin, tmp, targets, timeoutMs))?.failed ?? []);
      const introduced = patched.failed.filter(name => !baseline.has(name));
      return { status: introduced.length ? 'failed' : 'passed', errors: introduced.slice(0, 20) };
    } finally {
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });
}
