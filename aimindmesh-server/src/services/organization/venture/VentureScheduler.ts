import crypto from 'node:crypto';
import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import { InferenceRegistry } from '../../InferenceRegistry';
import { InferenceRouter } from '../../InferenceRouter';
import { OrganizationAuditService } from '../OrganizationAuditService';
import { getBuildSettings } from './BuildSettings';
import { ContainerValidationService, toRepoStatus } from './ContainerValidationService';
import { VentureWorkspace, giteaAuthHeader, giteaCloneUrl } from './VentureWorkspace';
import { AgentRunner, executeBuildRun, RepoRow, RunOutcome, sessionKeyOf } from './VentureBuildRun';
import { notifyOwner } from './notify';

const FIRST_TICK_DELAY_MS = 30_000; // lets the OpenClaw WebSocket connect first
const TICK_MS = 10 * 60_000;
const COOLDOWN_MINUTES = [5, 10, 20, 40, 60];

export type RunRequestResult = { started: true; runId: string } | { started: false; reason: 'disabled' | 'not_found' | 'busy' | 'blocked' | 'daily_limit' | 'run_budget' };

const audit = new OrganizationAuditService();

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * The only owner of venture development runs.
 *
 * A run holds the repository lock (`active_run_id`, taken with a compare-and-set) from the agent
 * run to the end of the validation. Every failure costs an attempt; after `maxAttempts` the
 * repository is `blocked` until a human unblocks it, and the attempt counter is reset only by a
 * validation that passes. Builds are off unless enabled in the build settings (kill switch).
 */
export class VentureScheduler {
  private static firstTick: NodeJS.Timeout | null = null;
  private static interval: NodeJS.Timeout | null = null;
  private static agent: AgentRunner | null = null;
  private static validator = new ContainerValidationService();

  /** Test seam: replaces the OpenClaw agent and the container validator. */
  public static configure(deps: { agent?: AgentRunner; validator?: ContainerValidationService }): void {
    if (deps.agent) this.agent = deps.agent;
    if (deps.validator) this.validator = deps.validator;
  }

  public static start(): void {
    this.stop();
    void this.reconcile();
    this.firstTick = setTimeout(() => void this.tick(), FIRST_TICK_DELAY_MS);
    this.interval = setInterval(() => void this.tick(), TICK_MS);
  }

  public static stop(): void {
    if (this.firstTick) clearTimeout(this.firstTick);
    if (this.interval) clearInterval(this.interval);
    this.firstTick = null;
    this.interval = null;
  }

  /**
   * Starts a run if the budget allows it. A human request also unblocks the repository and
   * gives it a fresh attempt budget.
   */
  public static requestRun(repoId: string, actor: 'human' | 'system'): RunRequestResult {
    const settings = getBuildSettings();
    if (!settings.enabled) return { started: false, reason: 'disabled' };
    const repo = db.prepare('SELECT id, validation_status FROM organization_repositories WHERE id = ?').get(repoId) as { id: string; validation_status: string } | undefined;
    if (!repo) return { started: false, reason: 'not_found' };

    if (actor === 'human') {
      db.prepare(`UPDATE organization_repositories SET retry_count = 0, blocked_reason = NULL, cooldown_until = NULL,
                  validation_status = CASE WHEN validation_status = 'blocked' THEN 'pending' ELSE validation_status END
                  WHERE id = ? AND active_run_id IS NULL`).run(repoId);
    } else if (repo.validation_status === 'blocked') {
      return { started: false, reason: 'blocked' };
    }

    const running = (db.prepare('SELECT COUNT(*) AS c FROM organization_repositories WHERE active_run_id IS NOT NULL').get() as { c: number }).c;
    if (running >= settings.maxConcurrentBuilds) return { started: false, reason: 'busy' };
    const runsToday = (db.prepare(`SELECT COUNT(*) AS c FROM organization_audit_log WHERE event_type = 'venture:run-start' AND created_at >= ?`).get(startOfDayIso()) as { c: number }).c;
    if (runsToday >= settings.dailyRunLimit) return { started: false, reason: 'daily_limit' };
    const runsOfRepo = (db.prepare(`SELECT COUNT(*) AS c FROM organization_audit_log WHERE event_type = 'venture:run-start' AND target_id = ?`).get(repoId) as { c: number }).c;
    if (runsOfRepo >= settings.maxRunsPerVenture) {
      db.prepare(`UPDATE organization_repositories SET validation_status = 'blocked', blocked_reason = ? WHERE id = ? AND active_run_id IS NULL`)
        .run(`Run budget spent (${runsOfRepo} runs): raise maxRunsPerVenture to continue`, repoId);
      return { started: false, reason: 'run_budget' };
    }

    const runId = crypto.randomUUID();
    const locked = db.prepare(`UPDATE organization_repositories SET active_run_id = ?, agent_last_triggered_at = ?, validation_status = 'evolving'
                               WHERE id = ? AND active_run_id IS NULL AND validation_status != 'blocked'`)
      .run(runId, new Date().toISOString(), repoId);
    if (locked.changes !== 1) return { started: false, reason: 'busy' };

    void audit.log({ eventType: 'venture:run-start', actorType: actor, actorId: actor, targetType: 'repository', targetId: repoId, payload: { runId } });
    void this.execute(repoId, runId);
    return { started: true, runId };
  }

  /**
   * Validates the published state of a repository in the background (manual check from the
   * panel; the outcome lands in `last_validation`). It takes the same lock as a run and changes
   * only the status, never the attempt budget.
   */
  public static startValidation(repoId: string): 'started' | 'not_found' | 'busy' {
    const repo = db.prepare('SELECT * FROM organization_repositories WHERE id = ?').get(repoId) as RepoRow | undefined;
    if (!repo) return 'not_found';
    const lockId = crypto.randomUUID();
    const locked = db.prepare('UPDATE organization_repositories SET active_run_id = ? WHERE id = ? AND active_run_id IS NULL').run(lockId, repoId);
    if (locked.changes !== 1) return 'busy';
    void this.validatePublished(repo, lockId);
    return 'started';
  }

  private static async validatePublished(repo: RepoRow, lockId: string): Promise<void> {
    try {
      const settings = getBuildSettings();
      const workspace = new VentureWorkspace(repo.repo_name);
      const remote = giteaCloneUrl(repo.gitea_url);
      const base = await workspace.prepare(remote, giteaAuthHeader(remote));
      const report = await this.validator.validate(repo.repo_name, () => workspace.archive(base), {
        image: settings.validationImage,
        timeoutMs: settings.validationTimeoutMs,
      });
      const status = toRepoStatus(report);
      db.prepare(`UPDATE organization_repositories SET last_validation = ?,
                  validation_status = CASE WHEN validation_status = 'blocked' THEN 'blocked' ELSE ? END WHERE id = ?`)
        .run(JSON.stringify({ status: report.status, summary: report.summary, failures: report.tests?.failures, at: new Date().toISOString() }), status, repo.id);
      void audit.log({ eventType: 'repo:validate', actorType: 'human', actorId: 'human', targetType: 'repository', targetId: repo.id, payload: { status, summary: report.summary } });
    } catch (err: any) {
      Logger.error('VentureScheduler', `Validation of ${repo.repo_name} failed: ${err.message}`);
      db.prepare('UPDATE organization_repositories SET last_validation = ? WHERE id = ?')
        .run(JSON.stringify({ status: 'failed', summary: `Validation could not run: ${err.message}`, at: new Date().toISOString() }), repo.id);
    } finally {
      db.prepare('UPDATE organization_repositories SET active_run_id = NULL WHERE id = ? AND active_run_id = ?').run(repo.id, lockId);
    }
  }

  /** Cancels the run in progress on a repository (the repository is then blocked). */
  public static cancelRun(repoId: string): boolean {
    const row = db.prepare('SELECT active_run_id FROM organization_repositories WHERE id = ?').get(repoId) as { active_run_id: string | null } | undefined;
    if (!row?.active_run_id) return false;
    InferenceRouter.cancelTask(row.active_run_id);
    return true;
  }

  private static async execute(repoId: string, runId: string): Promise<void> {
    const repo = db.prepare('SELECT * FROM organization_repositories WHERE id = ?').get(repoId) as RepoRow;
    const settings = getBuildSettings();
    const controller = new AbortController();
    InferenceRegistry.register(runId, 'AGENT_TASK', `Venture build: ${repo.repo_name}`, 'openclaw',
      { repoId, repoName: repo.repo_name, sessionKey: sessionKeyOf(repo.repo_name) }, 'openclaw');
    InferenceRegistry.setStatus(runId, 'PROCESSING');
    InferenceRouter.trackExternalTask(runId, () => controller.abort());

    let outcome: RunOutcome;
    try {
      const agent = this.agent ?? (await import('../../openclaw/agentRun')).openClawAgentRunner;
      outcome = await executeBuildRun(repo, settings, { agent, validator: this.validator, signal: controller.signal });
    } catch (err: any) {
      Logger.error('VentureScheduler', `Run ${runId.slice(0, 8)} on ${repo.repo_name} failed: ${err.message}`);
      outcome = { kind: 'failed', summary: `Internal error: ${err.message}` };
    } finally {
      InferenceRouter.untrackExternalTask(runId);
    }

    this.finish(repo, runId, outcome, settings.maxAttempts);
    InferenceRegistry.finish(runId, outcome.kind === 'healthy' ? outcome.summary : undefined,
      outcome.kind === 'failed' ? outcome.summary : outcome.kind === 'cancelled' ? 'CANCELLED_BY_USER' : undefined);
  }

  /** Releases the lock and records the outcome; the attempt counter resets only when validation passes. */
  private static finish(repo: RepoRow, runId: string, outcome: RunOutcome, maxAttempts: number): void {
    const release = (sql: string, ...params: unknown[]) =>
      db.prepare(`UPDATE organization_repositories SET active_run_id = NULL, ${sql} WHERE id = ? AND active_run_id = ?`).run(...params, repo.id, runId);

    if (outcome.kind === 'healthy') {
      // Next milestone: back to `pending`, the next tick (or the call below) starts it
      const status = outcome.next === 'milestone' ? 'pending' : 'healthy';
      release(`validation_status = ?, retry_count = 0, cooldown_until = NULL, blocked_reason = NULL`, status);
      if (repo.created_from_idea_id) {
        const ideaStatus = outcome.next === 'mvp_ready' ? 'mvp_ready' : 'development';
        db.prepare(`UPDATE organization_ideas SET status = ?, updated_at = ? WHERE id = ? AND status IN ('approved', 'characterized', 'development')`)
          .run(ideaStatus, new Date().toISOString(), repo.created_from_idea_id);
      }
      if (outcome.next === 'mvp_ready') {
        void notifyOwner('venture_run_finished', { repoId: repo.id, status: 'mvp_ready' }, { title: `🚀 ${repo.repo_name}: MVP ready`, body: 'Every milestone passes its acceptance tests. Continue, pivot or close it.', tab: 'ideas' });
      } else {
        void notifyOwner('venture_run_finished', { repoId: repo.id, status: 'healthy' }, { title: `✅ ${repo.repo_name} validated`, body: outcome.summary, tab: 'repos' });
      }
      if (outcome.next === 'milestone') setImmediate(() => this.requestRun(repo.id, 'system'));
    } else if (outcome.kind === 'cancelled') {
      release(`validation_status = 'blocked', blocked_reason = 'cancelled by user'`);
    } else {
      const attempts = (repo.retry_count ?? 0) + 1;
      if (attempts >= maxAttempts) {
        release(`validation_status = 'blocked', retry_count = ?, blocked_reason = ?`, attempts, `${attempts} failed attempts: ${outcome.summary}`.slice(0, 500));
        void notifyOwner('venture_run_finished', { repoId: repo.id, status: 'blocked' }, { title: `⛔ ${repo.repo_name} blocked`, body: `${attempts} failed attempts. ${outcome.summary}`, tab: 'repos' });
      } else {
        const minutes = COOLDOWN_MINUTES[Math.min(attempts - 1, COOLDOWN_MINUTES.length - 1)];
        release(`validation_status = 'cooldown', retry_count = ?, cooldown_until = ?`, attempts, new Date(Date.now() + minutes * 60_000).toISOString());
      }
    }
    void audit.log({
      eventType: 'venture:run-end',
      actorType: 'system',
      actorId: 'venture-scheduler',
      targetType: 'repository',
      targetId: repo.id,
      payload: { runId, outcome: outcome.kind, summary: outcome.kind === 'cancelled' ? 'cancelled' : outcome.summary },
    });
  }

  /** Boot: no run survives a restart. The interrupted attempt counts, leftover containers go. */
  private static async reconcile(): Promise<void> {
    const interrupted = db.prepare('SELECT * FROM organization_repositories WHERE active_run_id IS NOT NULL').all() as (RepoRow & { active_run_id: string })[];
    const maxAttempts = getBuildSettings().maxAttempts;
    for (const repo of interrupted) {
      this.finish(repo, repo.active_run_id, { kind: 'failed', summary: 'Interrupted by a server restart' }, maxAttempts);
    }
    try {
      const removed = await this.validator.sweep();
      if (removed > 0) Logger.warn('VentureScheduler', `Removed ${removed} leftover validation container(s)`);
    } catch (err: any) {
      Logger.warn('VentureScheduler', `Validation container sweep failed: ${err.message}`);
    }
  }

  /** Resumes repositories whose cooldown expired, and those never built (pending), one at a time. */
  private static async tick(): Promise<void> {
    try {
      if (!getBuildSettings().enabled) return;
      const due = db.prepare(`
        SELECT id FROM organization_repositories
        WHERE active_run_id IS NULL
          AND (validation_status = 'pending' OR (validation_status = 'cooldown' AND (cooldown_until IS NULL OR cooldown_until < ?)))
        ORDER BY agent_last_triggered_at ASC
      `).all(new Date().toISOString()) as { id: string }[];
      for (const { id } of due) {
        const result = this.requestRun(id, 'system');
        if (!result.started && result.reason !== 'blocked') break; // busy, daily limit or disabled: wait for the next tick
      }
    } catch (err: any) {
      Logger.error('VentureScheduler', `Tick failed: ${err.message}`);
    }
  }
}
