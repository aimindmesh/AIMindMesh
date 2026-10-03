import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { SERVER_ROOT } from './fixtures/config';
import localSttRoutes from '../src/api/routes/local-stt';
import { WikiManager } from '../src/services/WikiManager';
import { MultiFileContextBuilder } from '../src/services/MultiFileContextBuilder';

// Hostile names try to run `touch <marker>` through a shell: the marker must never appear
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-safety-'));
const marker = (name: string) => path.join(workDir, name);

afterAll(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('local-stt', () => {
  let app: FastifyInstance;
  const argsFile = marker('whisper-args.txt');

  beforeAll(async () => {
    // Fake whisper on PATH: records its argv, produces no transcript
    const bin = marker('bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'whisper'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${argsFile}"\n`, { mode: 0o755 });

    app = Fastify();
    await app.register(multipart);
    await app.register(localSttRoutes, { prefix: '/api/local-stt' });
  });

  it('never passes the uploaded file name to a shell', async () => {
    vi.stubEnv('PATH', `${marker('bin')}:${process.env.PATH}`);
    const boundary = '----aimindmesh';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.$(touch ${marker('pwn-stt')})"\r\nContent-Type: audio/wav\r\n\r\n`),
      Buffer.from('RIFFfake'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST', url: '/api/local-stt/v1/audio/transcriptions', payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(marker('pwn-stt'))).toBe(false);
    const args = fs.readFileSync(argsFile, 'utf-8').split('\n');
    expect(args[0]).toMatch(/\.wav$/); // hostile extension replaced
    expect(args.slice(1, 3)).toEqual(['--model', 'medium']);
  });
});

describe('WikiManager.commitChanges', () => {
  it('stores LLM-generated commit messages verbatim, without a shell', async () => {
    const repo = marker('wiki-repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'page.md'), 'x');
    (WikiManager as any).storageDir = repo;
    (WikiManager as any).gitEnabled = true;

    const message = `Update "page" $(touch ${marker('pwn-wiki')}) \`id\``;
    await WikiManager.commitChanges(message);

    await vi.waitFor(() => {
      const logged = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      expect(logged).toBe(message);
    }, { timeout: 5000 });
    expect(fs.existsSync(marker('pwn-wiki'))).toBe(false);
  });
});

describe('MultiFileContextBuilder reverse dependencies', () => {
  const builder = new MultiFileContextBuilder(undefined, SERVER_ROOT) as any;

  it('finds the real importers of a service', () => {
    const deps: string[] = builder.findReverseDependencies('src/services/KGManager.ts');
    expect(deps.length).toBeGreaterThan(0);
    expect(deps.every(d => !d.includes('node_modules'))).toBe(true);
  });

  it('treats hostile names as plain patterns', () => {
    expect(builder.findReverseDependencies(`src/x$(touch ${marker('pwn-grep')}).ts`)).toEqual([]);
    expect(fs.existsSync(marker('pwn-grep'))).toBe(false);
  });
});
