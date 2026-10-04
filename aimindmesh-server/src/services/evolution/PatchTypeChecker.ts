import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SERVER_DIR } from './EvolutionPathPolicy';

const execFileAsync = promisify(execFile);

/**
 * Type-checks a generated patch against the real server sources.
 *
 * The server `src/` is copied to a private temp dir, the patched files are laid over it
 * and `tsc --noEmit` runs on the copy: the live checkout is never touched.
 * Errors that already exist without the patch are not blamed on it.
 */

export interface PatchFile {
  /** Repo-root relative path, e.g. aimindmesh-server/src/services/WikiManager.ts */
  path: string;
  content: string;
}

export interface TypecheckResult {
  /** skipped: nothing type-checkable in the patch; unavailable: tsc is not installed */
  status: 'passed' | 'failed' | 'skipped' | 'unavailable';
  errors: string[];
  checkedFiles: string[];
}

// tsc needs ~360 MB: never run two checks at the same time
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** `src/...` path inside the server for a repo-root path, or null if it is not a server TS source. */
export function serverSourcePath(repoRootPath: string): string | null {
  const prefix = `${SERVER_DIR}/`;
  if (!repoRootPath.startsWith(prefix)) return null;
  const local = repoRootPath.slice(prefix.length);
  return local.startsWith('src/') && /\.tsx?$/.test(local) ? local : null;
}

/** "src/x.ts(12,5): error TS2322: msg" -> "src/x.ts: error TS2322: msg" (positions shift with the patch) */
function errorKey(line: string): string {
  return line.replace(/\(\d+,\d+\)/, '').trim();
}

async function runTsc(tscBin: string, cwd: string, timeoutMs: number): Promise<string[]> {
  try {
    await execFileAsync(tscBin, ['--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return [];
  } catch (err: any) {
    const output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    const diagnostics = output.split('\n').filter(line => /error TS\d+/.test(line)).map(line => line.trim());
    // Timeout, crash or bad config: no diagnostics to judge the patch on
    if (diagnostics.length === 0) throw new Error(`tsc did not complete: ${err.message}`);
    return diagnostics;
  }
}

export function typecheckPatch(repoPath: string, files: PatchFile[], timeoutMs: number): Promise<TypecheckResult> {
  const overlay = files
    .map(f => ({ local: serverSourcePath(f.path), content: f.content }))
    .filter((f): f is { local: string; content: string } => f.local !== null && typeof f.content === 'string');
  const checkedFiles = overlay.map(f => `${SERVER_DIR}/${f.local}`);

  if (overlay.length === 0) return Promise.resolve({ status: 'skipped', errors: [], checkedFiles });

  const tscBin = path.join(repoPath, 'node_modules', '.bin', 'tsc');
  if (!fs.existsSync(tscBin)) {
    return Promise.resolve({ status: 'unavailable', errors: [`TypeScript compiler not found at ${tscBin}`], checkedFiles });
  }

  return serialized(async (): Promise<TypecheckResult> => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'autoevo-tsc-'));
    try {
      await fs.promises.cp(path.join(repoPath, 'src'), path.join(tmp, 'src'), { recursive: true });
      await fs.promises.copyFile(path.join(repoPath, 'tsconfig.json'), path.join(tmp, 'tsconfig.json'));
      await fs.promises.symlink(path.join(repoPath, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');

      // Lay the patch over the copy, remembering the originals for the baseline run
      const originals = new Map<string, string | null>();
      for (const file of overlay) {
        const dest = path.join(tmp, file.local);
        if (!dest.startsWith(tmp + path.sep)) continue;
        originals.set(dest, fs.existsSync(dest) ? await fs.promises.readFile(dest, 'utf-8') : null);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, file.content);
      }

      const patched = await runTsc(tscBin, tmp, timeoutMs);
      if (patched.length === 0) return { status: 'passed', errors: [], checkedFiles };

      // Baseline: same copy without the patch, to discount pre-existing errors
      for (const [dest, original] of originals) {
        if (original === null) await fs.promises.rm(dest, { force: true });
        else await fs.promises.writeFile(dest, original);
      }
      const baseline = new Set((await runTsc(tscBin, tmp, timeoutMs)).map(errorKey));
      const introduced = patched.filter(line => !baseline.has(errorKey(line)));
      return { status: introduced.length > 0 ? 'failed' : 'passed', errors: introduced, checkedFiles };
    } finally {
      // rm does not follow the node_modules symlink
      await fs.promises.rm(tmp, { recursive: true, force: true });
    }
  });
}
