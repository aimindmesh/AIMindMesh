import db from '../../db/sqlite';
import { config } from '../../config';
import type { CodeGenerationOutput } from '../CodeGenerationTask';
import { canWrite, checkWritable } from './EvolutionPathPolicy';

/**
 * Guardrails shared by every auto-evolution entry point (cron cycle, admin UI, chat, feedback loop).
 */

/** Proposals created today (not failed) plus candidates started today and still in flight. */
export function getDailyLoad(): number {
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const proposals = db.prepare(
    `SELECT COUNT(*) as c FROM evolution_proposals WHERE created_at > ? AND status != 'failed'`
  ).get(startOfDay) as { c: number };
  const inFlight = db.prepare(
    `SELECT COUNT(*) as c FROM evolution_candidates WHERE status IN ('generating', 'validating') AND created_at > ?`
  ).get(startOfDay) as { c: number };
  return proposals.c + inFlight.c;
}

export function getDailyLimit(): number {
  return config.autoEvolution?.maxProposalsPerDay ?? 3;
}

export function isDailyLimitReached(): boolean {
  return getDailyLoad() >= getDailyLimit();
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * A candidate may proceed only if its target is writable. Disallowed affected components
 * are dropped rather than failing the candidate (LLMs often list config files there).
 */
export function checkCandidate(candidate: any): { ok: boolean; reason?: string; affected: string[] } {
  const repository = candidate.repository || candidate.repo_name || 'AIMindMesh';
  const target = candidate.targetComponent || candidate.target_component;
  if (!canWrite(repository, target)) {
    return { ok: false, reason: `Target path not allowed for auto-evolution: ${String(target)}`, affected: [] };
  }
  const affected = parseList(candidate.affectedComponents ?? candidate.affected_components)
    .filter((p): p is string => typeof p === 'string' && canWrite(repository, p));
  return { ok: true, affected };
}

/** Every path the generated output would commit: target, additional files and unit test. */
export function checkOutput(repository: string, target: string, output: CodeGenerationOutput): { ok: boolean; denied: string[] } {
  // Entries without a path are never committed (see GiteaEvolutionService), every other one is checked
  const additional = (output.additionalFiles ?? []).filter(f => f && f.path != null && f.path !== '').map(f => f.path);
  const paths: unknown[] = [target, ...additional];
  if (output.unitTestContent && output.unitTestPath) paths.push(output.unitTestPath);
  return checkWritable(repository, paths);
}

/**
 * Drops a generated unit test whose path is not writable (e.g. under the protected test/ dir)
 * instead of failing the whole proposal. Returns the path that was dropped, if any.
 */
export function sanitizeOutput(repository: string, output: CodeGenerationOutput): string | undefined {
  if (output.unitTestContent && output.unitTestPath && !canWrite(repository, output.unitTestPath)) {
    const dropped = output.unitTestPath;
    delete output.unitTestContent;
    delete output.unitTestPath;
    return dropped;
  }
  return undefined;
}
