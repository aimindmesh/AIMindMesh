import db from '../../../db/sqlite';
import type { IdeaProposal, SourceRef } from '../../../types/api';

export type DiscoveredIdea = IdeaProposal & { sources: SourceRef[] };

export interface SaveResult {
  saved: DiscoveredIdea[];
  skipped: { title: string; reason: 'duplicate' | 'low_score' }[];
}

const SIMILARITY_THRESHOLD = 0.8;

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter(w => w.length > 2));
}

/** Same normalized title, or word overlap (Jaccard) of at least 0.8. */
export function isDuplicateTitle(title: string, existing: string[]): boolean {
  const normalized = normalizeTitle(title);
  const own = words(title);
  return existing.some(other => {
    if (normalizeTitle(other) === normalized) return true;
    const theirs = words(other);
    if (own.size === 0 || theirs.size === 0) return false;
    const shared = [...own].filter(w => theirs.has(w)).length;
    return shared / (own.size + theirs.size - shared) >= SIMILARITY_THRESHOLD;
  });
}

/** Text form of the sources for the legacy `sourceSignals` field (older apps render strings). */
export function sourceSignals(sources: SourceRef[]): string[] {
  return sources.map(s => `${s.title} — ${s.url}`);
}

export function parseSources(raw: unknown): SourceRef[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter(s => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url)).map(s => ({ title: String(s.title ?? s.url), url: s.url }))
      : [];
  } catch {
    return [];
  }
}

/**
 * Persists discovered ideas: the only writer of discovery results, shared by the autonomous
 * engine and the manual "discover" route. Drops duplicates of existing ideas (any status) and
 * ideas below the score threshold.
 */
export function saveDiscovered(ideas: DiscoveredIdea[], minScore: number): SaveResult {
  const existing = (db.prepare('SELECT title FROM organization_ideas').all() as { title: string }[]).map(r => r.title);
  const result: SaveResult = { saved: [], skipped: [] };
  const insert = db.prepare(`
    INSERT INTO organization_ideas
      (id, title, problem_statement, summary, source_signals, sources_json, judge_rationale,
       strategic_score, feasibility_score, novelty_score, overall_score, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
  `);
  for (const idea of ideas) {
    if (isDuplicateTitle(idea.title, existing)) {
      result.skipped.push({ title: idea.title, reason: 'duplicate' });
      continue;
    }
    if (idea.overallScore < minScore) {
      result.skipped.push({ title: idea.title, reason: 'low_score' });
      continue;
    }
    insert.run(
      idea.id, idea.title, idea.problemStatement, idea.summary,
      JSON.stringify(sourceSignals(idea.sources)), JSON.stringify(idea.sources), idea.judgeRationale ?? null,
      idea.strategicScore, idea.feasibilityScore, idea.noveltyScore, idea.overallScore,
      idea.createdAt, idea.updatedAt,
    );
    existing.push(idea.title);
    result.saved.push({ ...idea, sourceSignals: sourceSignals(idea.sources) });
  }
  return result;
}
