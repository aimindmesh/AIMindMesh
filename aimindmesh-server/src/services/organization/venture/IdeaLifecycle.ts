import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import { OrganizationAuditService } from '../OrganizationAuditService';
import { OrganizationRegistry, SQLiteOrganizationRoleRepository } from '../OrganizationRegistry';
import { RolePolicyService } from '../RolePolicyService';
import { CouncilOrchestrator } from '../CouncilOrchestrator';
import { DesignOrchestrator } from '../DesignOrchestrator';
import { notifyOwner } from './notify';
import type { IdeaProposal, VentureDecision } from '../../../types/api';
import { deleteMilestones } from './Milestones';
import { VentureScheduler } from './VentureScheduler';

export type LifecycleOutcome = 'started' | 'not_found' | 'conflict';

/** Statuses from which a council review may start, and from which a human may approve a build. */
const REVIEWABLE = ['proposed', 'approved', 'rejected'];
const APPROVABLE = ['proposed', 'approved', 'rejected'];

const audit = new OrganizationAuditService();
// Characterizations in progress in this process (the only one): a double click starts one
const building = new Set<string>();

export function mapIdeaRow(row: any): IdeaProposal {
  return {
    id: row.id,
    title: row.title,
    problemStatement: row.problem_statement || '',
    summary: row.summary || '',
    sourceSignals: JSON.parse(row.source_signals || '[]'),
    strategicScore: row.strategic_score || 0,
    feasibilityScore: row.feasibility_score || 0,
    noveltyScore: row.novelty_score || 0,
    overallScore: row.overall_score || 0,
    status: row.status,
    analysisSynthesis: row.analysis_synthesis || null,
    humanFeedback: row.human_feedback || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ideaStatus(ideaId: string): string | null {
  const row = db.prepare('SELECT status FROM organization_ideas WHERE id = ?').get(ideaId) as { status: string } | undefined;
  return row?.status ?? null;
}

/** Compare-and-set of the idea status: true only for the caller that moved it. */
export function transitionIdea(ideaId: string, from: string[], to: string): boolean {
  const placeholders = from.map(() => '?').join(', ');
  const res = db.prepare(`UPDATE organization_ideas SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`)
    .run(to, new Date().toISOString(), ideaId, ...from);
  return res.changes === 1;
}

/**
 * Starts a council review in the background (status `reviewing`). The council only votes:
 * it never creates a repository.
 */
export function startCouncilReview(ideaId: string, humanFeedback?: string | null): LifecycleOutcome {
  const previous = ideaStatus(ideaId);
  if (previous === null) return 'not_found';
  if (!REVIEWABLE.includes(previous) || !transitionIdea(ideaId, [previous], 'reviewing')) return 'conflict';
  db.prepare('UPDATE organization_ideas SET human_feedback = ? WHERE id = ?').run(humanFeedback || null, ideaId);
  void runCouncilReview(ideaId, previous, humanFeedback).catch(err =>
    Logger.error('IdeaLifecycle', `Council review of ${ideaId} failed: ${err.message}`));
  return 'started';
}

/** Runs the council on an idea already in `reviewing`; returns the consensus. */
export async function runCouncilReview(ideaId: string, previous: string, humanFeedback?: string | null): Promise<boolean> {
  try {
    const row = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId);
    if (!row) throw new Error('Idea not found');
    const roles = await new OrganizationRegistry(new SQLiteOrganizationRoleRepository()).listRoles();
    const result = await new CouncilOrchestrator(new RolePolicyService()).reviewIdea('idea-review', mapIdeaRow(row), roles, humanFeedback);

    db.prepare(`UPDATE organization_ideas SET status = ?, analysis_synthesis = ?, updated_at = ? WHERE id = ? AND status = 'reviewing'`)
      .run(result.consensus ? 'approved' : 'rejected', result.synthesis, new Date().toISOString(), ideaId);
    await audit.log({
      eventType: 'idea:review',
      actorType: 'system',
      actorId: 'council-orchestrator',
      targetType: 'idea',
      targetId: ideaId,
      payload: { consensus: result.consensus, votes: result.votes, synthesis: result.synthesis, humanFeedback: humanFeedback ?? null },
    });
    await notifyOwner('idea_updated', { ideaId, status: result.consensus ? 'approved' : 'rejected' });
    return result.consensus;
  } catch (err) {
    // Back to where it was: the review can be started again
    transitionIdea(ideaId, ['reviewing'], previous);
    await audit.log({
      eventType: 'idea:review-failed',
      actorType: 'system',
      actorId: 'council-orchestrator',
      targetType: 'idea',
      targetId: ideaId,
      payload: { error: (err as Error).message },
    });
    await notifyOwner('idea_updated', { ideaId, status: previous });
    throw err;
  }
}

/**
 * The single gate to a build: characterization (spec), repository and development agent.
 * Called by a human (/approve, /transition) or by the auto-council only when
 * organization.allowAutoRepoCreation is true.
 */
export async function approveForBuild(ideaId: string, actor: 'human' | 'system', options: { wait?: boolean } = {}): Promise<LifecycleOutcome> {
  const status = ideaStatus(ideaId);
  if (status === null) return 'not_found';
  if (building.has(ideaId) || !APPROVABLE.includes(status) || !transitionIdea(ideaId, [status], 'approved')) return 'conflict';

  building.add(ideaId);
  await audit.log({ eventType: 'idea:approve', actorType: actor, actorId: actor, targetType: 'idea', targetId: ideaId, payload: { from: status } });
  const run = Promise.resolve()
    .then(() => DesignOrchestrator.characterizeIdea(ideaId))
    .catch(err => Logger.error('IdeaLifecycle', `Characterization of ${ideaId} failed: ${err.message}`))
    .finally(() => building.delete(ideaId));
  if (options.wait) await run;
  return 'started';
}

/** True while the idea has a repository with a development run or validation in progress. */
export function hasActiveBuild(ideaId: string): boolean {
  return !!db.prepare('SELECT 1 FROM organization_repositories WHERE created_from_idea_id = ? AND active_run_id IS NOT NULL').get(ideaId);
}

const DECISION_FROM: Record<VentureDecision, string[]> = {
  continue: ['mvp_ready'],
  pivot: ['mvp_ready', 'development'],
  kill: ['proposed', 'approved', 'rejected', 'characterized', 'development', 'mvp_ready'],
};

/**
 * The owner's decision on a venture:
 * - continue: new milestones from the notes (spec extension + acceptance tests), then builds resume;
 * - pivot: back to `approved` with the notes; the next approval writes a new spec for the same repository;
 * - kill: closed for good; the notes become memory for the discovery (no similar idea again).
 */
export function decideVenture(ideaId: string, decision: VentureDecision, notes: string): LifecycleOutcome {
  const status = ideaStatus(ideaId);
  if (status === null) return 'not_found';
  if (!DECISION_FROM[decision].includes(status) || hasActiveBuild(ideaId)) return 'conflict';

  const now = new Date().toISOString();
  if (decision === 'kill') {
    if (!transitionIdea(ideaId, [status], 'killed')) return 'conflict';
    db.prepare('UPDATE organization_ideas SET outcome_notes = ? WHERE id = ?').run(notes || null, ideaId);
    db.prepare(`UPDATE organization_repositories SET validation_status = 'blocked', blocked_reason = 'venture closed' WHERE created_from_idea_id = ?`).run(ideaId);
  } else if (decision === 'pivot') {
    if (!transitionIdea(ideaId, [status], 'approved')) return 'conflict';
    db.transaction(() => {
      db.prepare('UPDATE organization_ideas SET outcome_notes = ?, human_feedback = ?, updated_at = ? WHERE id = ?').run(notes || null, notes || null, now, ideaId);
      db.prepare('DELETE FROM organization_product_designs WHERE idea_id = ?').run(ideaId);
      deleteMilestones(ideaId);
    })();
  } else {
    if (building.has(ideaId)) return 'conflict';
    building.add(ideaId);
    void DesignOrchestrator.extendSpec(ideaId, notes)
      .then(() => {
        transitionIdea(ideaId, ['mvp_ready'], 'development');
        const repo = db.prepare('SELECT id FROM organization_repositories WHERE created_from_idea_id = ?').get(ideaId) as { id: string } | undefined;
        if (!repo) return;
        db.prepare(`UPDATE organization_repositories SET validation_status = 'pending', retry_count = 0, blocked_reason = NULL WHERE id = ? AND active_run_id IS NULL`).run(repo.id);
        VentureScheduler.requestRun(repo.id, 'system');
      })
      .catch(async err => {
        Logger.error('IdeaLifecycle', `Extension of ${ideaId} failed: ${err.message}`);
        await notifyOwner('idea_updated', { ideaId, status: 'mvp_ready', error: err.message }, { title: 'Venture extension failed', body: err.message });
      })
      .finally(() => building.delete(ideaId));
  }
  void audit.log({ eventType: `venture:decision-${decision}`, actorType: 'human', actorId: 'human', targetType: 'idea', targetId: ideaId, payload: { from: status, notes } });
  return 'started';
}
