import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import db from '../../db/sqlite';
import { config } from '../../config';
import { Logger } from '../../utils/Logger';

/**
 * Single source of truth for which repository paths the auto-evolution pipeline
 * may read (send to an LLM) and write (commit to Gitea).
 *
 * Paths are repo-root relative, e.g. `aimindmesh-server/src/services/WikiManager.ts`.
 * For repositories other than AIMindMesh itself only syntactic normalization applies.
 */

export const SERVER_DIR = 'aimindmesh-server';
const S = SERVER_DIR;

const TOP_LEVEL_DIRS = [
  S, 'aimindmesh-mobile', 'aimindmesh-client', 'aimindmesh-admin-mobile', 'aimindmesh-hermes',
  'infrastructure', 'scratch', '.local_scripts', '.gitea', '.github', '.vscode',
];

const MATCH_OPTIONS = { dot: true, nocase: true };
const TEMPLATE_FILE = /\.(example|template)$/i;
const CACHE_TTL_MS = 5000;

// Never read nor written: credentials, runtime data, private deployment scripts
const SECRET_PATTERNS = [
  '**/config.json',
  '**/.env', '**/.env.*',
  '**/*service-account*.json', '**/google-services.json',
  '**/openclaw-config/**', '**/openclaw-workspace/**', '**/hermes-data/**',
  `${S}/data/**`, `${S}/backups/**`,
  '**/*.{db,sqlite,sqlite3,pem,key,p12,jks,keystore,bak}',
  `${S}/src/config.ts`,
  '**/deploy_*.sh', '**/publish_android*.sh', '**/distribute_linux*.sh', '**/ssh_tunnel*.sh', '**/backup_private*.sh',
  '**/.git/**', '**/node_modules/**',
];

// Never written, whatever .noautoedit or the DB say: the guardrails themselves, auth, build & deploy
const PROTECTED_BASELINE = [
  `${S}/src/services/evolution/**`,
  // The venture factory runs agents and pushes code: its safety rules are not for the pipeline to rewrite
  `${S}/src/services/organization/**`,
  `${S}/src/services/openclaw/**`,
  `${S}/src/services/OpenClawBridge.ts`,
  `${S}/templates/ventures/**`,
  `${S}/src/services/{AutoEvolutionPipeline,GiteaEvolutionService,ImprovementDetector,InferenceRouter,AiTaskScheduler,ProactiveEngine,DebateEngine,ValidationLayer,CodeGenerationTask,MultiFileContextBuilder,FeedbackService}.ts`,
  `${S}/src/middleware/**`,
  `${S}/src/utils/{configRedaction,shell,lenientJsonParser}.ts`,
  `${S}/src/types/api.ts`,
  `${S}/test/**`, `${S}/vitest.config.*`,
  `${S}/src/api/routes/{giteaWebhook,admin}.ts`,
  `${S}/src/api/websocket/**`,
  `${S}/src/index.ts`,
  `${S}/src/db/**`,
  `${S}/src/config.ts*`,
  `${S}/{Dockerfile,*.Dockerfile,docker-compose.yml,entrypoint.sh,.dockerignore,package.json,package-lock.json,pm2.config.js}`,
  '.noautoedit',
  '**/.gitignore', '**/.gitea/**', '**/.github/**', '**/*.sh',
  // npm lifecycle scripts and build configs run in CI (`npm ci`) and on developer machines
  '**/package.json', '**/package-lock.json', '**/.npmrc', '**/tsconfig*.json', '**/vite.config.*',
  'infrastructure/**',
  'aimindmesh-client/src-tauri/**',
  'aimindmesh-mobile/android/app/src/main/java/com/aimindmesh/mobile/MainActivity.java',
  'aimindmesh-mobile/android/app/src/main/java/com/aimindmesh/mobile/proactive/ProactiveBackgroundService.kt',
  'aimindmesh-mobile/android/app/src/main/AndroidManifest.xml',
  'aimindmesh-mobile/capacitor.config.ts',
];

export function getRepoLocalPath(): string {
  return config.autoEvolution?.repoLocalPath ?? path.join(__dirname, '../../..');
}

/** True for the AIMindMesh repository itself (Gitea names are case-insensitive). */
export function isSelfRepo(repository?: string | null): boolean {
  const repo = String(repository ?? '').trim().toLowerCase().replace(/\.git$/, '');
  if (!repo) return true; // callers default to AIMindMesh: apply the strict mode
  const configured = String(config.autoEvolution?.giteaRepoName ?? '').trim().toLowerCase();
  return repo === 'aimindmesh' || (configured !== '' && repo === configured);
}

/** Validates a Gitea repository name before it is interpolated into API URLs. */
export function normalizeRepoName(repository: unknown): string | null {
  if (typeof repository !== 'string') return null;
  const repo = repository.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(repo) || repo === '.' || repo === '..') return null;
  return repo;
}

/**
 * Canonical repo-root relative POSIX path, or null when the path is unsafe
 * (absolute, traversal, or characters that would break the Gitea contents-API URL).
 */
export function normalizeRepoPath(repository: string | undefined | null, p: unknown): string | null {
  if (typeof p !== 'string') return null;
  let s = p.trim();
  if (!s || /[\0\\?#%]/.test(s)) return null;
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  s = s.replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
  if (!s || s.endsWith('/')) return null;
  if (s.split('/').some(seg => seg === '..' || seg === '.')) return null;
  // A leading src/ always meant the server: local reads already treat it that way
  if (isSelfRepo(repository) && s.startsWith('src/')) s = `${S}/${s}`;
  return s;
}

function startsWithTopLevelDir(p: string): boolean {
  return TOP_LEVEL_DIRS.some(dir => p === dir || p.startsWith(`${dir}/`));
}

/** All the ways a path can be understood: literal, server-relative and server-prefixed. */
function interpretations(p: string): string[] {
  const forms = new Set<string>([p]);
  if (!startsWithTopLevelDir(p)) forms.add(`${S}/${p}`);
  if (p.startsWith(`${S}/`)) forms.add(p.slice(S.length + 1));
  return [...forms];
}

const matchesAny = (p: string, patterns: string[]) => patterns.some(pattern => minimatch(p, pattern, MATCH_OPTIONS));

let noAutoEditCache: { at: number; patterns: string[] } | null = null;

/** User-maintained .noautoedit, looked up in the server dir and in the repo root. */
function loadNoAutoEdit(): string[] {
  if (noAutoEditCache && Date.now() - noAutoEditCache.at < CACHE_TTL_MS) return noAutoEditCache.patterns;
  const repoPath = getRepoLocalPath();
  const patterns = new Set<string>();
  for (const file of [path.join(repoPath, '.noautoedit'), path.join(repoPath, '..', '.noautoedit')]) {
    try {
      if (!fs.existsSync(file)) continue;
      fs.readFileSync(file, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .forEach(l => patterns.add(l.endsWith('/') ? `${l}**` : l));
    } catch (err: any) {
      Logger.warn('EvolutionPathPolicy', `Cannot read ${file}: ${err.message}`);
    }
  }
  noAutoEditCache = { at: Date.now(), patterns: [...patterns] };
  return noAutoEditCache.patterns;
}

let dbProtectedCache: { at: number; prefixes: string[] } | null = null;

/** Prefixes added at runtime from the admin UI (table protected_paths). */
function loadDbProtectedPrefixes(): string[] {
  if (dbProtectedCache && Date.now() - dbProtectedCache.at < CACHE_TTL_MS) return dbProtectedCache.prefixes;
  let prefixes: string[] = [];
  try {
    const rows = db.prepare(`SELECT path FROM protected_paths`).all() as { path: string }[];
    prefixes = rows
      .map(r => String(r.path ?? '').trim().replace(/^(\.\/)+/, ''))
      .filter(Boolean);
  } catch {
    // Table missing on very old databases: nothing extra to protect
  }
  dbProtectedCache = { at: Date.now(), prefixes };
  return prefixes;
}

export function isSecretPath(p: string): boolean {
  return interpretations(p).some(form => !TEMPLATE_FILE.test(form) && matchesAny(form, SECRET_PATTERNS));
}

export function isProtectedPath(p: string): boolean {
  const forms = interpretations(p);
  const patterns = [...PROTECTED_BASELINE, ...loadNoAutoEdit()];
  if (forms.some(form => matchesAny(form, patterns))) return true;
  // Literal prefix match (the old SQL LIKE treated _ and % as wildcards)
  const prefixes = loadDbProtectedPrefixes();
  return forms.some(form => prefixes.some(prefix => form.startsWith(prefix)));
}

/** May the content of this path be read and included in a prompt for a (cloud) LLM? */
export function canSendToLLM(repository: string | undefined | null, p: unknown): boolean {
  const normalized = normalizeRepoPath(repository, p);
  if (!normalized) return false;
  return !isSelfRepo(repository) || !isSecretPath(normalized);
}

/** May the pipeline commit this path? */
export function canWrite(repository: string | undefined | null, p: unknown): boolean {
  const normalized = normalizeRepoPath(repository, p);
  if (!normalized) return false;
  return !isSelfRepo(repository) || (!isSecretPath(normalized) && !isProtectedPath(normalized));
}

export function checkWritable(repository: string | undefined | null, paths: unknown[]): { ok: boolean; denied: string[] } {
  const denied: string[] = [];
  if (repository != null && repository !== '' && !normalizeRepoName(repository)) denied.push(`repository:${String(repository)}`);
  for (const p of paths) {
    if (!canWrite(repository, p)) denied.push(String(p));
  }
  return { ok: denied.length === 0, denied };
}

/** True when an absolute local path is inside the server checkout and not a secret. */
export function isLocalPathAllowed(absPath: string, repoPath: string = getRepoLocalPath()): boolean {
  const rel = path.relative(path.resolve(repoPath), path.resolve(absPath));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return !isSecretPath(`${S}/${rel.split(path.sep).join('/')}`);
}

/**
 * Absolute local path of a self-repo file (server checkout), or null when it must not be read locally:
 * other repositories, unsafe or secret paths, or anything resolving outside the checkout.
 */
export function resolveLocalServerPath(repository: string | undefined | null, p: unknown, repoPath: string = getRepoLocalPath()): string | null {
  if (!isSelfRepo(repository)) return null;
  const normalized = normalizeRepoPath(repository, p);
  if (!normalized || isSecretPath(normalized)) return null;
  const local = normalized.startsWith(`${S}/`) ? normalized.slice(S.length + 1) : normalized;
  const abs = path.resolve(repoPath, local);
  return isLocalPathAllowed(abs, repoPath) ? abs : null;
}
