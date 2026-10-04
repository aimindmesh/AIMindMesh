import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { giteaAuthHeader, giteaCloneUrl, VentureWorkspace, WorkspaceRoots } from '../src/services/organization/venture/VentureWorkspace';

let tmp: string;
let roots: WorkspaceRoots;
let remote: string;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venture-ws-'));
  roots = { gitRoot: path.join(tmp, 'git'), workRoot: path.join(tmp, 'work'), agentUid: 1000, agentGid: 1000 };
  // A "Gitea" repository with one commit on main
  remote = path.join(tmp, 'remote.git');
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', remote);
  const seed = path.join(tmp, 'seed');
  git(tmp, 'clone', '--quiet', remote, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# venture\n');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
  git(seed, 'push', '--quiet', 'origin', 'HEAD:main');
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('venture workspace', () => {
  it('keeps the git dir out of the agent work tree and pushes what the agent wrote', async () => {
    const ws = new VentureWorkspace('demo', roots);
    const base = await ws.prepare(remote);
    expect(fs.existsSync(path.join(ws.workTree, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(ws.workTree, '.git'))).toBe(false);

    // The agent writes code, dependencies and a secret file
    fs.writeFileSync(path.join(ws.workTree, 'index.js'), 'console.log(1);\n');
    fs.mkdirSync(path.join(ws.workTree, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(ws.workTree, 'node_modules', 'x', 'i.js'), '');
    fs.writeFileSync(path.join(ws.workTree, '.env'), 'SECRET=1\n');

    const sha = await ws.snapshot('agent run 1');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    await ws.push(remote, sha!);

    const files = git(tmp, '--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n');
    expect(files.sort()).toEqual(['README.md', 'index.js']);
    expect(await ws.log(base, sha!)).toEqual([expect.stringContaining('agent run 1')]);
  });

  it('returns null when the agent changed nothing and resets to the last pushed state', async () => {
    const ws = new VentureWorkspace('demo', roots);
    await ws.prepare(remote);
    expect(await ws.snapshot('nothing')).toBeNull();
    fs.writeFileSync(path.join(ws.workTree, 'scratch.txt'), 'x');
    await ws.prepare(remote);
    expect(fs.existsSync(path.join(ws.workTree, 'scratch.txt'))).toBe(false);
  });

  it('ignores hooks planted in the git dir', async () => {
    const ws = new VentureWorkspace('demo', roots);
    await ws.prepare(remote);
    const hook = path.join(ws.gitDir, 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\ntouch "$0.ran"\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(ws.workTree, 'a.txt'), 'a');
    expect(await ws.snapshot('with hook')).toMatch(/^[0-9a-f]{40}$/);
    expect(fs.existsSync(`${hook}.ran`)).toBe(false);
  });

  it('refuses a work tree replaced by a symlink', async () => {
    const ws = new VentureWorkspace('demo', roots);
    await ws.prepare(remote);
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.rmSync(ws.workTree, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, ws.workTree);
    await expect(ws.prepare(remote)).rejects.toThrow(/not a directory|outside its root/);
    await expect(ws.snapshot('x')).rejects.toThrow(/outside its root/);
  });

  it('restores server-owned files without following the symlinks the agent planted', async () => {
    const ws = new VentureWorkspace('demo', roots);
    await ws.prepare(remote);
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    // the agent swaps acceptance/ for a symlink to a server directory and adds a stray test
    fs.symlinkSync(outside, path.join(ws.workTree, 'acceptance'));
    fs.writeFileSync(path.join(ws.workTree, 'vitest.config.ts'), 'tampered');

    const changed = await ws.writeFiles({ 'acceptance/AC-1.test.ts': 'canonical', 'vitest.config.ts': 'config' }, ['acceptance']);

    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.lstatSync(path.join(ws.workTree, 'acceptance')).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(ws.workTree, 'acceptance/AC-1.test.ts'), 'utf-8')).toBe('canonical');
    expect(changed).toContain('vitest.config.ts');

    fs.writeFileSync(path.join(ws.workTree, 'acceptance/extra.test.ts'), 'agent test');
    fs.writeFileSync(path.join(ws.workTree, 'acceptance/AC-1.test.ts'), 'weakened');
    expect((await ws.writeFiles({ 'acceptance/AC-1.test.ts': 'canonical' }, ['acceptance'])).sort())
      .toEqual(['acceptance/AC-1.test.ts', 'acceptance/extra.test.ts']);
    expect(fs.readdirSync(path.join(ws.workTree, 'acceptance'))).toEqual(['AC-1.test.ts']);
    await expect(ws.writeFiles({ '../escape.txt': 'x' })).rejects.toThrow('Invalid workspace path');
  });

  it('rejects unsafe slugs', () => {
    expect(() => new VentureWorkspace('../etc', roots)).toThrow('Invalid venture slug');
    expect(() => new VentureWorkspace('a/b', roots)).toThrow('Invalid venture slug');
  });
});

describe('gitea helpers', () => {
  it('sends the token only to the configured Gitea host', () => {
    process.env.GITEA_URL = 'http://gitea:3000';
    process.env.GITEA_TOKEN = 'tok';
    expect(giteaAuthHeader('http://gitea:3000/labs/x.git')).toBe('Authorization: token tok');
    expect(giteaAuthHeader('http://evil.example/labs/x.git')).toBeUndefined();
  });

  it('builds a clone URL without credentials', () => {
    expect(giteaCloneUrl('http://token:abc@gitea:3000/labs/x')).toBe('http://gitea:3000/labs/x.git');
  });
});
