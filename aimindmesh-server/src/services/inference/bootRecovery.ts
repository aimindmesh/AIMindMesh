import db from '../../db/sqlite';
import { InferenceRegistry } from '../InferenceRegistry';
import { Logger } from '../../utils/Logger';
import { ClaudeBatchQueue } from './claude/ClaudeBatchQueue';
import { routerState } from './routerState';
import type { TaskPayload } from './routerTypes';

type Enqueue = (task: TaskPayload, id: string) => Promise<{ provider: string, response: string }>;

/**
 * After a restart: ends what cannot resume (venture agent runs, tasks older than 24 h unless a
 * Claude batch holds them) and re-queues the rest 5 s later, running the completion listeners
 * on their results.
 */
export function recoverQueueAfterRestart(enqueue: Enqueue): void {
  // Venture agent runs and validations cannot resume after a restart: the run is lost and
  // re-triggering here raced with the venture watchdog (two agents on one repo). They end here.
  const interrupted = db.prepare(`
    UPDATE inference_queue SET status = 'FAILED', error_msg = 'Interrupted by restart', completed_at = ?
    WHERE type = 'AGENT_TASK' AND status IN ('QUEUED', 'PROCESSING', 'WAITING', 'STALLED', 'PAUSED')
  `).run(Date.now());
  if (interrupted.changes > 0) Logger.warn('InferenceRouter', `${interrupted.changes} venture agent task(s) interrupted by the restart`);

  // Select PROCESSING tasks to determine their fate
  const procRows = db.prepare(`SELECT id, created_at FROM inference_queue WHERE status = 'PROCESSING'`).all() as any[];
  for (const row of procRows) {
    const ageMs = Date.now() - row.created_at;
    // If task was already processing for > 24h, mark as FAILED instead of re-queuing
    // (a task waiting on a Claude batch keeps it: the batch has its own expiry)
    if (ageMs > 24 * 60 * 60 * 1000 && !ClaudeBatchQueue.has(row.id)) {
      db.prepare(`UPDATE inference_queue SET status = 'FAILED', error_msg = 'Interrupted by restart and already exceeded 24h limit' WHERE id = ?`).run(row.id);
      Logger.warn('InferenceRouter', `Task [${row.id.slice(0, 8)}] discarded on boot: was already >24h old and in PROCESSING state.`);
    } else {
      db.prepare(`UPDATE inference_queue SET status = 'QUEUED' WHERE id = ?`).run(row.id);
    }
  }

  // IMPORTANT: Only recover RECENT tasks (< 24 hours old).
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const staleResult = db.prepare(`UPDATE inference_queue SET status = 'FAILED', error_msg = 'Discarded on restart: task too old'
    WHERE status = 'QUEUED' AND created_at < ?
      AND id NOT IN (SELECT task_id FROM claude_batch_requests WHERE status IN ('pending', 'submitted', 'done'))`).run(twentyFourHoursAgo);
  if (staleResult.changes > 0) Logger.warn('InferenceRouter', `Discarded ${staleResult.changes} stale tasks (older than 24h) on startup.`);

  const rows = db.prepare("SELECT * FROM inference_queue WHERE status = 'QUEUED' OR status = 'PROCESSING' OR status = 'WAITING' OR status = 'STALLED' OR status = 'PAUSED'").all() as any[];
  Logger.info('InferenceRouter', `Recovering ${rows.length} pending inferences...`);
  for (const row of rows) {
    try {
      const task = JSON.parse(row.payload) as TaskPayload;
      if (!task.options) task.options = {};
      InferenceRegistry.register(row.id, row.type, row.task_name, task.options?.model, task, task.options?.routing || 'AUTO');
      setTimeout(() => {
        enqueue(task, row.id).then(async (res) => {
          // 1. Run listeners first
          let listenerError: string | null = null;
          for (const listener of routerState.completionListeners) {
            try {
              await listener(row.id, res.response, task.metadata, task.type);
            } catch (e: any) {
              Logger.error('InferenceRouter', `Recovery listener failed for [${row.id.slice(0, 8)}]: ${e.message}`);
              listenerError = e.message;
            }
          }
          // 2. Finalize status based on both inference AND listener success
          if (listenerError) {
            InferenceRegistry.finish(row.id, undefined, `LISTENER_FAILED: ${listenerError}`);
          } else {
            InferenceRegistry.finish(row.id, res.response);
          }
        }).catch(e => {
          InferenceRegistry.finish(row.id, undefined, e.message);
          Logger.warn('InferenceRouter', `Recovered task ${row.id} failed: ${e.message}`);
        });
      }, 5000);
    } catch (e) { Logger.warn('InferenceRouter', `Recovery parse failed for task ${row.id}`); }
  }
}
