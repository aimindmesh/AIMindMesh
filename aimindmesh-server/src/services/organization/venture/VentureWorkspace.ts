import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 5 * 60_000;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
// Never committed by the server snapshot, whatever the agent leaves in the work tree
const EXCLUDES = ['node_modules/', 'dist/', 'build/', 'coverage/', '.env', '.env.*', '*.log', '.npm/', '.cache/'];
const COMMITTER = ['-c', 'user.name=AIMindMesh Venture Bot', '-c', 'user.email=ventures@aimindmesh.local'];

export interface WorkspaceRoots {
  /** Server-only directory holding one git dir per venture. */
  gitRoot: string;
  /** Mount shared with the agent (its `ventures/` folder): only work trees, never a git dir. */
  workRoot: string;
  /** Owner of the work tree files, i.e. the OpenClaw container user. */
  agentUid: number;
  agentGid: number;
}

export function defaultWorkspaceRoots(): WorkspaceRoots {
  const serverRoot = path.resolve(__dirname, '../../../..');
  return {
    gitRoot: process.env.VENTURE_GIT_DIR || path.join(serverRoot, 'data', 'ventures'),
    workRoot: process.env.VENTURE_WORKSPACES_DIR || path.join(serverRoot, 'venture-workspaces'),
    agentUid: Number(process.env.VENTURE_AGENT_UID ?? 1000),
    agentGid: Number(process.env.VENTURE_AGENT_GID ?? 1000),
  };
}

/**
 * The working copy of one venture repository.
 *
 * The git dir lives on the server (`gitRoot/<slug>.git`), the files in the agent's mount
 * (`workRoot/<slug>`): the agent edits files but has no git, no remote and no credentials.
 * The server runs git as root on an agent-writable tree, so every call disables hooks,
 * fsmonitor and system/global config, and the work tree path must resolve to itself.
 * Fetch and push authenticate with a header passed through the environment only.
 */
export class VentureWorkspace {
  readonly gitDir: string;
  readonly workTree: string;

  constructor(readonly slug: string, private readonly roots: WorkspaceRoots = defaultWorkspaceRoots()) {
    if (!SLUG.test(slug) || slug.includes('..')) throw new Error(`Invalid venture slug: ${slug}`);
    this.gitDir = path.join(roots.gitRoot, `${slug}.git`);
    this.workTree = path.join(roots.workRoot, slug);
  }

  /** Path of the project as the agent sees it (relative to its workspace). */
  get agentPath(): string {
    return `ventures/${this.slug}`;
  }

  /** Fetches the remote and resets the work tree to its default branch (the last validated state). */
  async prepare(remoteUrl: string, authHeader?: string, branch = 'main'): Promise<string> {
    await this.ensureGitDir();
    await this.ensureWorkTree();
    await this.git(['fetch', '--quiet', '--no-tags', '--prune', remoteUrl, `+refs/heads/${branch}:refs/remotes/origin/${branch}`], authHeader);
    const base = (await this.git(['rev-parse', `refs/remotes/origin/${branch}`])).trim();
    await this.git(['checkout', '--quiet', '--force', '-B', 'work', base]);
    await this.git(['clean', '-ffdx', '--quiet', '-e', 'node_modules']);
    await this.handOver();
    return base;
  }

  /** Commits what the agent changed. Returns the new commit, or null when nothing changed. */
  async snapshot(message: string): Promise<string | null> {
    await this.assertWorkTree();
    await this.git(['add', '--all']);
    const status = await this.git(['status', '--porcelain']);
    if (!status.trim()) return null;
    await this.git([...COMMITTER, 'commit', '--quiet', '--no-verify', '-m', message]);
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  /** Tar stream of a commit: only tracked files, symlinks stored as links (never followed). */
  archive(ref: string): Readable {
    const child = spawn('git', [...this.baseArgs(), 'archive', '--format=tar', ref], { env: this.env(), stdio: ['ignore', 'pipe', 'ignore'] });
    return child.stdout;
  }

  async push(remoteUrl: string, ref: string, authHeader?: string, branch = 'main'): Promise<void> {
    await this.git(['push', '--quiet', remoteUrl, `${ref}:refs/heads/${branch}`], authHeader);
    await this.git(['update-ref', `refs/remotes/origin/${branch}`, ref]);
  }

  /**
   * Writes server-owned files into the work tree (scaffold, acceptance tests, test config).
   * Path components the agent replaced with symlinks or files are removed first, nothing is
   * followed; in `exclusiveDirs` every file that is not in `files` is deleted. Returns the
   * paths whose content the agent had changed (or added).
   */
  async writeFiles(files: Record<string, string>, exclusiveDirs: string[] = []): Promise<string[]> {
    await this.assertWorkTree();
    const changed: string[] = [];
    for (const dir of exclusiveDirs) {
      const abs = await this.safeDir(dir);
      for (const entry of await fs.promises.readdir(abs)) {
        const rel = `${dir}/${entry}`;
        if (!(rel in files)) {
          await fs.promises.rm(path.join(abs, entry), { recursive: true, force: true });
          changed.push(rel);
        }
      }
    }
    for (const [rel, content] of Object.entries(files)) {
      const parts = rel.split('/');
      if (parts.some(p => !p || p === '.' || p === '..')) throw new Error(`Invalid workspace path: ${rel}`);
      const dir = await this.safeDir(parts.slice(0, -1).join('/'));
      const target = path.join(dir, parts[parts.length - 1]);
      const stat = await fs.promises.lstat(target).catch(() => null);
      if (stat && !stat.isFile()) {
        await fs.promises.rm(target, { recursive: true, force: true });
        changed.push(rel);
      } else if (stat && (await fs.promises.readFile(target, 'utf-8')) !== content) {
        changed.push(rel);
      }
      await fs.promises.writeFile(target, content);
    }
    return changed;
  }

  async exists(rel: string): Promise<boolean> {
    return !!(await fs.promises.lstat(path.join(this.workTree, rel)).catch(() => null));
  }

  /** Gives the files to the agent user (after the server wrote into the work tree). */
  async handOverToAgent(): Promise<void> {
    await this.handOver();
  }

  /** A real directory under the work tree, created as needed; symlinks or files in the way are removed. */
  private async safeDir(rel: string): Promise<string> {
    let current = this.workTree;
    for (const part of rel ? rel.split('/') : []) {
      if (!part || part === '.' || part === '..') throw new Error(`Invalid workspace path: ${rel}`);
      current = path.join(current, part);
      const stat = await fs.promises.lstat(current).catch(() => null);
      if (stat && !stat.isDirectory()) await fs.promises.rm(current, { recursive: true, force: true });
      if (!stat || !stat.isDirectory()) await fs.promises.mkdir(current);
    }
    return current;
  }

  async headCommit(): Promise<string> {
    return (await this.git(['rev-parse', 'HEAD'])).trim();
  }

  /** Commits between two refs, oldest first (for reports). */
  async log(from: string, to: string): Promise<string[]> {
    const out = await this.git(['log', '--format=%h %s', '--reverse', `${from}..${to}`]);
    return out.split('\n').filter(Boolean);
  }

  private baseArgs(): string[] {
    return [
      `--git-dir=${this.gitDir}`, `--work-tree=${this.workTree}`,
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.symlinks=true',
      '-c', 'submodule.recurse=false',
    ];
  }

  private env(authHeader?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: this.roots.gitRoot,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    };
    if (authHeader) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
      env.GIT_CONFIG_VALUE_0 = authHeader;
    }
    return env;
  }

  private async git(args: string[], authHeader?: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...this.baseArgs(), ...args], {
        env: this.env(authHeader),
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout;
    } catch (err: any) {
      // The header is never in args, but keep error text free of it anyway
      const text = String(err.stderr || err.message || err).split(authHeader || '\u0000').join('***');
      throw new Error(`git ${args[0]} failed: ${text.trim().slice(0, 500)}`);
    }
  }

  private async ensureGitDir(): Promise<void> {
    await fs.promises.mkdir(this.roots.gitRoot, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(path.join(this.gitDir, 'HEAD'))) {
      await execFileAsync('git', ['init', '--quiet', '--bare', this.gitDir], { env: this.env(), timeout: GIT_TIMEOUT_MS });
    }
    await fs.promises.mkdir(path.join(this.gitDir, 'info'), { recursive: true });
    await fs.promises.writeFile(path.join(this.gitDir, 'info', 'exclude'), EXCLUDES.join('\n') + '\n');
  }

  /** The shared root is created by the server and not writable by the agent (it cannot rename work trees). */
  private async ensureWorkTree(): Promise<void> {
    await fs.promises.mkdir(this.roots.workRoot, { recursive: true });
    try {
      await fs.promises.chmod(this.roots.workRoot, 0o755);
    } catch {
      // Not the owner (local development): the realpath check below still applies
    }
    const stat = await fs.promises.lstat(this.workTree).catch(() => null);
    if (stat && !stat.isDirectory()) {
      throw new Error(`Venture work tree ${this.workTree} is not a directory`);
    }
    if (!stat) await fs.promises.mkdir(this.workTree);
    await this.assertWorkTree();
  }

  /** Refuses to run git when the work tree (or a parent) was replaced by a symlink. */
  private async assertWorkTree(): Promise<void> {
    const expected = path.join(await fs.promises.realpath(this.roots.workRoot), this.slug);
    const actual = await fs.promises.realpath(this.workTree);
    if (actual !== expected) throw new Error(`Venture work tree ${this.workTree} resolves outside its root`);
  }

  /** Gives the files to the agent user without following symlinks. */
  private async handOver(): Promise<void> {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
    await execFileAsync('chown', ['-R', '-h', '-P', `${this.roots.agentUid}:${this.roots.agentGid}`, this.workTree], { timeout: GIT_TIMEOUT_MS });
  }
}

/** Authorization header for Gitea, sent only to the configured Gitea host. */
export function giteaAuthHeader(remoteUrl: string): string | undefined {
  const token = process.env.GITEA_TOKEN;
  const base = process.env.GITEA_URL;
  if (!token || !base) return undefined;
  try {
    if (new URL(remoteUrl).host !== new URL(base).host) return undefined;
  } catch {
    return undefined;
  }
  return `Authorization: token ${token}`;
}

/** Clone URL of a Gitea repository from its web URL (no credentials in it). */
export function giteaCloneUrl(webUrl: string): string {
  const url = new URL(webUrl);
  url.username = '';
  url.password = '';
  const plain = url.toString().replace(/\/$/, '');
  return plain.endsWith('.git') ? plain : `${plain}.git`;
}
