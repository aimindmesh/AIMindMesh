import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../config';
import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import type { PromptParts } from '../promptParts';
import { claudeClient } from './claudeClient';
import { ClaudeError, classifyClaudeError, type ClaudeErrorKind } from './claudeErrors';
import { estimateCostUsd } from './claudePricing';
import { buildClaudeParams, finishClaudeMessage, reportClaudeFailure } from './ClaudeProvider';
import { claudeSettings } from './claudeSettings';
import { ClaudeUsage, type SpendSummary, type UsageSource } from './ClaudeUsage';

type BatchRowStatus = 'pending' | 'submitted' | 'done' | 'failed' | 'cancelled';
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

interface BatchRow {
  task_id: string;
  batch_id: string | null;
  status: BatchRowStatus;
  params: string;
  source: UsageSource;
  est_cost_usd: number;
  result_text: string | null;
  error: string | null;
  attempts: number;
  created_at: number;
}

/** What a row stores: the request and the task type its answer is checked against. */
interface StoredRequest {
  taskType: string;
  request: CreateParams;
}

interface Waiter {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
}

export interface BatchRequestOptions {
  taskType: string;
  parts: PromptParts;
  model?: string;
  thinking?: boolean;
  source?: UsageSource;
}

const MAX_ATTEMPTS = 2;
const KEEP_FINISHED_MS = 48 * 3_600_000;

/**
 * Claude Message Batches (half price) for background tasks. One row per task in
 * claude_batch_requests makes it idempotent and restart-proof: a task dispatched again after a
 * restart, a brake or a cooldown waits for its existing request (or takes its stored result)
 * instead of paying for a second one. Requests arriving within `batch.windowMs` share a batch;
 * one poller per batch reads the results by custom_id (the task id).
 */
export class ClaudeBatchQueue {
  private static started = false;
  private static reservationsRegistered = false;
  private static startWaiters: Array<() => void> = [];
  private static waiters = new Map<string, Waiter[]>();
  private static pollers = new Map<string, NodeJS.Timeout>();
  private static flushTimer: NodeJS.Timeout | null = null;

  private static row(taskId: string): BatchRow | undefined {
    return db.prepare('SELECT * FROM claude_batch_requests WHERE task_id = ?').get(taskId) as BatchRow | undefined;
  }

  private static setStatus(taskId: string, status: BatchRowStatus, fields: { result?: string; error?: string; batchId?: string; expiresAt?: number } = {}): void {
    db.prepare(`
      UPDATE claude_batch_requests SET status = ?, result_text = COALESCE(?, result_text), error = COALESCE(?, error),
        batch_id = COALESCE(?, batch_id), expires_at = COALESCE(?, expires_at),
        submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
        completed_at = CASE WHEN ? IN ('done', 'failed', 'cancelled') THEN ? ELSE completed_at END
      WHERE task_id = ?
    `).run(status, fields.result ?? null, fields.error ?? null, fields.batchId ?? null, fields.expiresAt ?? null,
      status, Date.now(), status, Date.now(), taskId);
  }

  /** True while the task has a request in a batch (the stale checks leave it alone). */
  public static has(taskId: string): boolean {
    const row = this.row(taskId);
    return !!row && (row.status === 'pending' || row.status === 'submitted' || row.status === 'done');
  }

  /** Estimated cost of the requests whose results are not recorded yet (counted against the budget). */
  public static reserved(): SpendSummary {
    const out: SpendSummary = { total: 0, bySource: { router: 0, agent: 0, builder: 0 } };
    try {
      const rows = db.prepare("SELECT source, SUM(est_cost_usd) AS cost FROM claude_batch_requests WHERE status IN ('pending', 'submitted') GROUP BY source").all() as { source: UsageSource; cost: number }[];
      for (const r of rows) {
        out.bySource[r.source] = (out.bySource[r.source] ?? 0) + (r.cost ?? 0);
        out.total += r.cost ?? 0;
      }
    } catch { /* table missing before migration: nothing reserved */ }
    return out;
  }

  public static pendingCount(): number {
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM claude_batch_requests WHERE status IN ('pending', 'submitted')").get() as { n: number }).n;
    } catch {
      return 0;
    }
  }

  /**
   * Starts sending and polling. Called at boot once the result listeners (wiki, evolution,
   * improvements) are registered: until then a result read back could reach no listener.
   */
  public static start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.reservationsRegistered) {
      this.reservationsRegistered = true;
      ClaudeUsage.registerReservations(() => this.reserved());
    }
    db.prepare("DELETE FROM claude_batch_requests WHERE status IN ('done', 'failed', 'cancelled') AND created_at < ?").run(Date.now() - KEEP_FINISHED_MS);
    const submitted = db.prepare("SELECT DISTINCT batch_id FROM claude_batch_requests WHERE status IN ('submitted', 'cancelled') AND batch_id IS NOT NULL").all() as { batch_id: string }[];
    for (const { batch_id } of submitted) this.schedulePoll(batch_id, 0);
    if (db.prepare("SELECT 1 FROM claude_batch_requests WHERE status = 'pending' LIMIT 1").get()) this.scheduleFlush();
    for (const resume of this.startWaiters.splice(0)) resume();
    Logger.info('ClaudeBatchQueue', `Started: ${submitted.length} batch(es) to follow, ${this.pendingCount()} request(s) open`);
  }

  /** Result of the task's batch request, submitting one if it has none. */
  public static async submitAndWait(taskId: string, opts: BatchRequestOptions, signal?: AbortSignal): Promise<string> {
    if (!this.started) await new Promise<void>(resolve => this.startWaiters.push(resolve));
    if (signal?.aborted) throw new ClaudeError('aborted', 'batch request aborted');

    let existing = this.row(taskId);
    if (existing?.status === 'done') {
      db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
      return existing.result_text ?? '';
    }
    if (existing?.status === 'failed') {
      db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
      throw this.storedError(existing);
    }
    if (existing?.status === 'cancelled') {
      // A request cancelled earlier (re-route, then back to Claude): ask again; the old one's cost goes unrecorded
      db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
      existing = undefined;
    }
    if (!existing) this.insert(taskId, opts);

    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      this.waiters.set(taskId, [...(this.waiters.get(taskId) ?? []), waiter]);
      signal?.addEventListener('abort', () => {
        this.waiters.set(taskId, (this.waiters.get(taskId) ?? []).filter(w => w !== waiter));
        // A brake only pauses the task: its request stays and is awaited again when it resumes
        if (signal.reason !== 'BRAKE') this.cancel(taskId);
        reject(new ClaudeError('aborted', `batch request ${String(signal.reason ?? 'aborted')}`));
      }, { once: true });
    });
  }

  private static insert(taskId: string, opts: BatchRequestOptions): void {
    const request = buildClaudeParams({ taskType: opts.taskType, parts: opts.parts, model: opts.model, thinking: opts.thinking });
    const promptChars = (opts.parts.cachePrefix?.length ?? 0) + opts.parts.body.length;
    const est = estimateCostUsd(request.model, promptChars, request.max_tokens, true);
    const stored: StoredRequest = { taskType: opts.taskType, request };
    db.prepare(`
      INSERT OR REPLACE INTO claude_batch_requests (task_id, batch_id, status, params, source, est_cost_usd, attempts, created_at)
      VALUES (?, NULL, 'pending', ?, ?, ?, 0, ?)
    `).run(taskId, JSON.stringify(stored), opts.source ?? 'router', est, Date.now());
    ClaudeUsage.resetCache();
    this.scheduleFlush();
  }

  private static storedError(row: BatchRow): ClaudeError {
    const [kind, ...rest] = (row.error ?? 'transient:unknown').split(':');
    return new ClaudeError(kind as ClaudeErrorKind, rest.join(':') || 'batch request failed');
  }

  /** A task no longer wants its result (cancelled or moved): drop it, cancelling a batch it had alone. */
  public static cancel(taskId: string): void {
    const row = this.row(taskId);
    if (!row || (row.status !== 'pending' && row.status !== 'submitted')) return;
    if (row.status === 'pending') {
      db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
      return;
    }
    // Submitted: the result is still read when the batch ends, to record what it cost
    this.setStatus(taskId, 'cancelled');
    const others = db.prepare("SELECT COUNT(*) AS n FROM claude_batch_requests WHERE batch_id = ? AND status = 'submitted'").get(row.batch_id) as { n: number };
    if (others.n === 0 && row.batch_id) {
      const client = claudeClient();
      client?.beta.messages.batches.cancel(row.batch_id).catch(err => Logger.warn('ClaudeBatchQueue', `Cancel of batch ${row.batch_id} failed: ${err.message}`));
    }
  }

  private static scheduleFlush(): void {
    if (this.flushTimer || !this.started) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, claudeSettings().batch.windowMs);
  }

  private static settle(taskId: string, outcome: { text?: string; error?: ClaudeError }): void {
    const waiters = this.waiters.get(taskId) ?? [];
    this.waiters.delete(taskId);
    if (waiters.length === 0) return; // kept in the table: the task takes it when it is dispatched again
    db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
    for (const w of waiters) outcome.error ? w.reject(outcome.error) : w.resolve(outcome.text ?? '');
  }

  private static fail(taskId: string, error: ClaudeError): void {
    this.setStatus(taskId, 'failed', { error: `${error.kind}:${error.message}` });
    this.settle(taskId, { error });
  }

  /** Sends every pending request as one batch. */
  private static async flush(): Promise<void> {
    if (config.infrastructureBrake) {
      // Nothing leaves while the brake is on: try again later
      this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, claudeSettings().batch.pollMs);
      return;
    }
    const rows = db.prepare("SELECT * FROM claude_batch_requests WHERE status = 'pending' ORDER BY created_at").all() as BatchRow[];
    if (rows.length === 0) return;
    const client = claudeClient();
    if (!client) {
      for (const r of rows) this.fail(r.task_id, new ClaudeError('auth', 'no API key configured'));
      return;
    }
    try {
      const batch = await client.beta.messages.batches.create({
        requests: rows.map(r => ({ custom_id: r.task_id, params: (JSON.parse(r.params) as StoredRequest).request as any })),
      });
      const expiresAt = Date.parse(batch.expires_at) || undefined;
      for (const r of rows) {
        // A request cancelled during the upload is still in the batch: keep it cancelled
        const current = this.row(r.task_id);
        if (!current) continue;
        if (current.status === 'pending') this.setStatus(r.task_id, 'submitted', { batchId: batch.id, expiresAt });
        else db.prepare('UPDATE claude_batch_requests SET batch_id = ? WHERE task_id = ?').run(batch.id, r.task_id);
      }
      Logger.info('ClaudeBatchQueue', `Batch ${batch.id} submitted with ${rows.length} request(s)`);
      this.schedulePoll(batch.id, claudeSettings().batch.pollMs);
    } catch (err) {
      const error = classifyClaudeError(err);
      reportClaudeFailure(error);
      Logger.warn('ClaudeBatchQueue', `Batch submission failed: ${error.message}`);
      for (const r of rows) this.fail(r.task_id, error);
    }
  }

  private static schedulePoll(batchId: string, delayMs: number): void {
    if (this.pollers.has(batchId)) return;
    this.pollers.set(batchId, setTimeout(() => {
      this.pollers.delete(batchId);
      void this.poll(batchId);
    }, delayMs));
  }

  private static async poll(batchId: string): Promise<void> {
    const client = claudeClient();
    const pollMs = claudeSettings().batch.pollMs;
    if (!client) {
      this.schedulePoll(batchId, pollMs);
      return;
    }
    try {
      const batch = await client.beta.messages.batches.retrieve(batchId);
      if (batch.processing_status !== 'ended') {
        this.schedulePoll(batchId, pollMs);
        return;
      }
      const seen = new Set<string>();
      for await (const item of await client.beta.messages.batches.results(batchId)) {
        seen.add(item.custom_id);
        this.applyResult(item.custom_id, item.result);
      }
      // Requests the batch did not return: failed, so their tasks move on
      const left = db.prepare("SELECT task_id FROM claude_batch_requests WHERE batch_id = ? AND status IN ('submitted', 'cancelled')").all(batchId) as { task_id: string }[];
      for (const { task_id } of left) {
        if (!seen.has(task_id)) this.fail(task_id, new ClaudeError('transient', 'missing from the batch results'));
      }
      this.flushIfPending();
    } catch (err) {
      Logger.warn('ClaudeBatchQueue', `Polling batch ${batchId} failed: ${(err as Error).message}`);
      this.schedulePoll(batchId, pollMs);
    }
  }

  private static flushIfPending(): void {
    if (db.prepare("SELECT 1 FROM claude_batch_requests WHERE status = 'pending' LIMIT 1").get()) this.scheduleFlush();
  }

  private static applyResult(taskId: string, result: Anthropic.Beta.Messages.Batches.BetaMessageBatchResult): void {
    const row = this.row(taskId);
    if (!row) return;
    const stored = JSON.parse(row.params) as StoredRequest;
    if (result.type === 'succeeded') {
      try {
        const text = finishClaudeMessage(result.message, stored.request.model, stored.taskType, row.source, 'batch');
        if (row.status === 'cancelled') {
          db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
          return;
        }
        this.setStatus(taskId, 'done', { result: text });
        this.settle(taskId, { text });
      } catch (err) {
        if (row.status === 'cancelled') db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
        else this.fail(taskId, classifyClaudeError(err));
      }
      return;
    }
    if (row.status === 'cancelled') {
      db.prepare('DELETE FROM claude_batch_requests WHERE task_id = ?').run(taskId);
      return;
    }
    const invalid = result.type === 'errored' && result.error?.error?.type === 'invalid_request_error';
    if ((result.type === 'expired' || (result.type === 'errored' && !invalid)) && row.attempts + 1 < MAX_ATTEMPTS) {
      // Server error or expiry: the same request goes into the next batch
      db.prepare("UPDATE claude_batch_requests SET status = 'pending', batch_id = NULL, attempts = attempts + 1 WHERE task_id = ?").run(taskId);
      return;
    }
    const detail = result.type === 'errored' ? (result.error?.error?.message ?? 'errored') : result.type;
    this.fail(taskId, new ClaudeError(invalid ? 'invalid' : result.type === 'canceled' ? 'aborted' : 'transient', `batch ${detail}`));
  }

  /** Test helper: forget timers and waiters. */
  public static resetForTests(): void {
    for (const t of this.pollers.values()) clearTimeout(t);
    this.pollers.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.waiters.clear();
    this.started = false;
    this.startWaiters = [];
  }
}
