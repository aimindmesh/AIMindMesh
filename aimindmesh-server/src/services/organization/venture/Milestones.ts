import { randomUUID } from 'node:crypto';
import db from '../../../db/sqlite';
import type { VentureMilestone } from '../../../types/api';
import type { VentureSpec } from './VentureSpec';

export interface MilestoneRow {
  id: string;
  idea_id: string;
  seq: number;
  title: string;
  criteria_json: string;
  status: VentureMilestone['status'];
  attempts: number;
  passed_json: string | null;
}

const parseList = (raw: string | null): string[] => {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

export const criteriaOf = (row: MilestoneRow) => parseList(row.criteria_json);

/** Appends the spec milestones after the existing ones (a new spec starts at 1). */
export function createMilestones(ideaId: string, milestones: VentureSpec['milestones']): void {
  const last = (db.prepare('SELECT MAX(seq) AS s FROM organization_venture_milestones WHERE idea_id = ?').get(ideaId) as { s: number | null }).s ?? 0;
  const insert = db.prepare(`INSERT INTO organization_venture_milestones (id, idea_id, seq, title, criteria_json, status, attempts, updated_at)
                             VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`);
  milestones.forEach((m, i) => insert.run(randomUUID(), ideaId, last + i + 1, m.title, JSON.stringify(m.criteria), new Date().toISOString()));
}

export function deleteMilestones(ideaId: string): void {
  db.prepare('DELETE FROM organization_venture_milestones WHERE idea_id = ?').run(ideaId);
}

export function milestoneRows(ideaId: string): MilestoneRow[] {
  return db.prepare('SELECT * FROM organization_venture_milestones WHERE idea_id = ? ORDER BY seq').all(ideaId) as MilestoneRow[];
}

export function listMilestones(ideaId: string): VentureMilestone[] {
  return milestoneRows(ideaId).map(row => ({
    seq: row.seq,
    title: row.title,
    criteria: criteriaOf(row),
    status: row.status,
    attempts: row.attempts,
    passed: parseList(row.passed_json),
  }));
}

/** The milestone to work on: the first one not done. Null when every milestone is done. */
export function currentMilestone(ideaId: string): MilestoneRow | null {
  return milestoneRows(ideaId).find(row => row.status !== 'done') ?? null;
}

/** Criteria that must pass to complete `upTo`: its own and those of every earlier milestone. */
export function requiredCriteria(ideaId: string, upTo: MilestoneRow): string[] {
  return milestoneRows(ideaId).filter(row => row.seq <= upTo.seq).flatMap(criteriaOf);
}

export function recordMilestoneAttempt(row: MilestoneRow, passed: string[], done: boolean): void {
  db.prepare(`UPDATE organization_venture_milestones SET attempts = attempts + 1, passed_json = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(passed), done ? 'done' : 'in_progress', new Date().toISOString(), row.id);
}

export interface StoredDesign {
  spec: VentureSpec;
  acceptance: Record<string, string>;
}

/** Structured spec and acceptance tests of an idea (null for designs made before the funnel). */
export function loadDesign(ideaId: string): StoredDesign | null {
  const row = db.prepare('SELECT spec_json, acceptance_json FROM organization_product_designs WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(ideaId) as { spec_json: string | null; acceptance_json: string | null } | undefined;
  if (!row?.spec_json) return null;
  try {
    return { spec: JSON.parse(row.spec_json), acceptance: JSON.parse(row.acceptance_json || '{}') };
  } catch {
    return null;
  }
}
