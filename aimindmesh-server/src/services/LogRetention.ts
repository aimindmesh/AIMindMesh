import db from '../db/sqlite';
import { config } from '../config';
import { Logger } from '../utils/Logger';

const DEFAULT_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 5000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

// Append-only tables that nothing else prunes (gemini_calls is pruned by InferenceRouter)
const LOG_TABLES = ['system_logs', 'fcm_logs', 'sync_logs'] as const;

/**
 * Retention from `config.logging.retentionDays`, read tolerantly: config.ts is not
 * versioned, so the field is optional and untyped. Invalid values fall back to 14 days.
 */
export function retentionDays(): number {
  const value = Number((config.logging as { retentionDays?: unknown } | undefined)?.retentionDays);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_RETENTION_DAYS;
}

/** Deletes old rows in batches, yielding between them so requests are never blocked for long. */
export async function pruneLogs(now = Date.now()): Promise<Record<string, number>> {
  const cutoff = now - retentionDays() * DAY_MS;
  const deleted: Record<string, number> = {};
  for (const table of LOG_TABLES) {
    const batch = db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE timestamp < ? LIMIT ?)`);
    deleted[table] = 0;
    for (;;) {
      const { changes } = batch.run(cutoff, BATCH_SIZE);
      deleted[table] += changes;
      if (changes < BATCH_SIZE) break;
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return deleted;
}

export class LogRetention {
  private static timer: NodeJS.Timeout | null = null;

  /** First run shortly after boot, then every 6 hours. */
  public static start() {
    if (this.timer) return;
    const run = () => pruneLogs()
      .then(deleted => {
        const total = Object.values(deleted).reduce((a, b) => a + b, 0);
        if (total > 0) Logger.info('LogRetention', `Pruned ${total} rows older than ${retentionDays()} days`, deleted);
      })
      .catch(err => Logger.error('LogRetention', `Pruning failed: ${err.message}`));
    setTimeout(run, 60_000).unref();
    this.timer = setInterval(run, INTERVAL_MS);
    this.timer.unref();
  }
}
