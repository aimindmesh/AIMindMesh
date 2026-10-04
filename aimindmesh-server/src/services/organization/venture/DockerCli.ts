import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface DockerResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface DockerOptions {
  /** Piped to the command's stdin (e.g. a tar archive for `docker exec -i`). */
  input?: Readable;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Thin seam over the docker CLI: an args array, never a shell. Tests replace it. */
export interface DockerCli {
  run(args: string[], options?: DockerOptions): Promise<DockerResult>;
}

const MAX_OUTPUT = 512 * 1024;

/** Keeps the end of a stream: errors and test summaries are printed last. */
function appendTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf-8');
  return next.length > MAX_OUTPUT ? next.slice(next.length - MAX_OUTPUT) : next;
}

export const dockerCli: DockerCli = {
  run(args, { input, timeoutMs = 60_000, signal } = {}) {
    return new Promise(resolve => {
      const child = spawn('docker', args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const kill = () => child.kill('SIGKILL');
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      signal?.addEventListener('abort', kill, { once: true });

      child.stdout!.on('data', (c: Buffer) => { stdout = appendTail(stdout, c); });
      child.stderr!.on('data', (c: Buffer) => { stderr = appendTail(stderr, c); });
      if (input && child.stdin) {
        input.on('error', () => child.stdin?.destroy());
        child.stdin.on('error', () => { /* the command exited before reading everything */ });
        input.pipe(child.stdin);
      }
      child.on('error', err => { stderr += `\n${err.message}`; });
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', kill);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  },
};
