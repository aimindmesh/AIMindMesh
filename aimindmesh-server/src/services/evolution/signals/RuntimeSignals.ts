import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from '../../../db/sqlite';
import { canWrite, SERVER_DIR } from '../EvolutionPathPolicy';

/**
 * Evidence for auto-evolution taken from how the server actually behaves: recurring errors in
 * system_logs and recurring failures of inference tasks, grouped by a normalized message.
 */
export interface RuntimeSignal {
  kind: 'runtime_error' | 'inference_failure';
  fingerprint: string;
  module: string;
  /** Normalized message shared by the group. */
  pattern: string;
  count: number;
  /** Distinct days with at least one occurrence. */
  days: number;
  firstSeen: number;
  lastSeen: number;
  examples: string[];
  /** Repo-root path of the file to change, when it is known for sure. */
  target: string | null;
  /** Files that may be involved (repo-root paths). */
  candidates: string[];
}

export interface SignalOptions {
  sinceMs: number;
  minOccurrences: number;
  minDays: number;
  limit: number;
}

// Failures of the environment, not defects of the code: never a reason to change it
const OPERATIONAL = /timeout|timed out|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|\b(429|502|503|504)\b|rate.?limit|quota|offline|not reachable|unreachable|aborted|cancelled|CANCELLED_BY_USER|Interrupted by restart|Zombie task|Network disabled/i;

export function isOperational(message: string): boolean {
  return OPERATIONAL.test(message);
}

/** Message with its variable parts (ids, numbers, quoted values, URLs, paths) replaced. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '<str>')
    .replace(/\[[0-9a-z]{6,10}\]/gi, '[<id>]')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const fingerprintOf = (kind: string, module: string, pattern: string) =>
  crypto.createHash('sha256').update(`${kind}|${module}|${pattern}`).digest('hex').slice(0, 32);

const dayOf = (ts: number) => Math.floor(ts / 86_400_000);

function serverRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

let srcIndex: { at: number; files: string[] } | null = null;

/** Server TypeScript sources (repo-root paths), cached for a minute. */
function serverSources(): string[] {
  if (srcIndex && Date.now() - srcIndex.at < 60_000) return srcIndex.files;
  const root = path.join(serverRoot(), 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(`${SERVER_DIR}/src/${path.relative(root, full).split(path.sep).join('/')}`);
    }
  };
  try {
    walk(root);
  } catch {
    // no sources (unexpected layout): no mapping
  }
  srcIndex = { at: Date.now(), files };
  return files;
}

/** dist/x/y.js:12 in a stack trace -> aimindmesh-server/src/x/y.ts */
export function fileFromStack(stack: string): string | null {
  for (const match of stack.matchAll(/(?:\/app\/|aimindmesh-server\/)?(?:dist|src)\/([\w/.-]+)\.(?:js|ts):\d+/g)) {
    const candidate = `${SERVER_DIR}/src/${match[1]}.ts`;
    if (serverSources().includes(candidate)) return candidate;
  }
  return null;
}

/** Files that log with this module tag, best guess first (same file name). */
export function filesForModule(module: string): string[] {
  const all = serverSources();
  const byName = all.filter(f => path.basename(f, '.ts') === module);
  if (byName.length === 1) return byName;
  const tag = new RegExp(`Logger\\.(error|warn)\\(\\s*['"\`]${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
  return all.filter(f => {
    try {
      return tag.test(fs.readFileSync(path.join(serverRoot(), f.slice(SERVER_DIR.length + 1)), 'utf-8'));
    } catch {
      return false;
    }
  });
}

function group<T extends { module: string; message: string; timestamp: number; stack?: string }>(
  kind: RuntimeSignal['kind'], rows: T[], options: SignalOptions,
): RuntimeSignal[] {
  const groups = new Map<string, { module: string; pattern: string; rows: T[] }>();
  for (const row of rows) {
    if (isOperational(row.message)) continue;
    const pattern = normalizeMessage(row.message);
    const key = fingerprintOf(kind, row.module, pattern);
    const entry = groups.get(key) ?? { module: row.module, pattern, rows: [] };
    entry.rows.push(row);
    groups.set(key, entry);
  }
  const signals: RuntimeSignal[] = [];
  for (const [fingerprint, g] of groups) {
    const days = new Set(g.rows.map(r => dayOf(r.timestamp))).size;
    if (g.rows.length < options.minOccurrences || days < options.minDays) continue;
    const stackTarget = g.rows.map(r => (r.stack ? fileFromStack(r.stack) : null)).find(Boolean) ?? null;
    const candidates = (stackTarget ? [stackTarget] : filesForModule(g.module)).filter(f => canWrite('AIMindMesh', f));
    signals.push({
      kind,
      fingerprint,
      module: g.module,
      pattern: g.pattern,
      count: g.rows.length,
      days,
      firstSeen: Math.min(...g.rows.map(r => r.timestamp)),
      lastSeen: Math.max(...g.rows.map(r => r.timestamp)),
      examples: [...new Set(g.rows.map(r => r.message.slice(0, 500)))].slice(0, 3),
      target: candidates.length === 1 ? candidates[0] : null,
      candidates: candidates.slice(0, 10),
    });
  }
  return signals.sort((a, b) => b.count * b.days - a.count * a.days).slice(0, options.limit);
}

/** Recurring ERROR lines of system_logs. */
export function collectRuntimeErrors(options: SignalOptions): RuntimeSignal[] {
  const rows = db.prepare(`SELECT module, message, metadata, timestamp FROM system_logs WHERE level = 'ERROR' AND timestamp >= ?`)
    .all(options.sinceMs) as { module: string; message: string; metadata: string | null; timestamp: number }[];
  return group('runtime_error', rows.map(r => {
    let stack: string | undefined;
    try {
      const meta = r.metadata ? JSON.parse(r.metadata) : null;
      stack = typeof meta?.stack === 'string' ? meta.stack : typeof meta?.error?.stack === 'string' ? meta.error.stack : undefined;
    } catch {
      stack = undefined;
    }
    return { module: r.module, message: r.message, timestamp: r.timestamp, stack };
  }), options);
}

/** Recurring failures of inference tasks (by task type). */
export function collectInferenceFailures(options: SignalOptions): RuntimeSignal[] {
  const rows = db.prepare(`SELECT type, error_msg, COALESCE(completed_at, created_at) AS ts FROM inference_queue
                           WHERE status = 'FAILED' AND error_msg IS NOT NULL AND COALESCE(completed_at, created_at) >= ?`)
    .all(options.sinceMs) as { type: string; error_msg: string; ts: number }[];
  return group('inference_failure', rows.map(r => ({ module: r.type, message: r.error_msg, timestamp: r.ts })), options);
}

/** 6 for an error seen a handful of times, up to 10 for one that happens every day. */
export function severityOf(signal: Pick<RuntimeSignal, 'count' | 'days'>): number {
  return Math.min(10, 5 + Math.floor(Math.log2(Math.max(1, signal.count)) / 2) + (signal.days >= 3 ? 1 : 0) + (signal.days >= 7 ? 1 : 0));
}
