import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import type { PricedUsage } from './claudePricing';

/** Who spent the tokens: the inference router, the agents (OpenClaw, Hermes) or venture builds. */
export type UsageSource = 'router' | 'agent' | 'builder';
export type UsageMode = 'realtime' | 'batch';

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Current billing cycle: from the last renewal day to the next one (UTC days). A cycle day
 * beyond the end of a month falls on its last day (29 → 28 February).
 */
export function cycleBounds(cycleDay: number, now = new Date()): { start: Date; end: Date } {
  const at = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(cycleDay, last)));
  };
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let start = at(y, m);
  if (start.getTime() > now.getTime()) start = at(y, m - 1);
  const end = at(start.getUTCFullYear(), start.getUTCMonth() + 1);
  return { start, end };
}

export interface SpendSummary {
  total: number;
  bySource: Record<UsageSource, number>;
}

export interface DayTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

/** Token usage and estimated cost of Claude, per day, model, mode and source. */
export class ClaudeUsage {
  private static spendCache: { cycleStart: string; summary: SpendSummary } | null = null;
  private static reservations: Array<() => SpendSummary> = [];

  public static record(source: UsageSource, mode: UsageMode, usage: PricedUsage, now = new Date()): void {
    const { tokens } = usage;
    try {
      db.prepare(`
        INSERT INTO claude_usage (date, model, mode, source, calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(date, model, mode, source) DO UPDATE SET
          calls = calls + 1,
          input_tokens = input_tokens + excluded.input_tokens,
          output_tokens = output_tokens + excluded.output_tokens,
          cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
          cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
          cost_usd = cost_usd + excluded.cost_usd
      `).run(utcDate(now), usage.model, mode, source, tokens.input, tokens.output,
        tokens.cacheWrite5m + tokens.cacheWrite1h, tokens.cacheRead, usage.costUsd);
    } catch (err: any) {
      Logger.warn('ClaudeUsage', `Failed to record usage: ${err.message}`);
    }
    this.spendCache = null;
  }

  /** Spend of the cycle that started at `cycleStart` (recorded usage only). */
  public static cycleSpend(cycleStart: Date): SpendSummary {
    const key = utcDate(cycleStart);
    if (this.spendCache?.cycleStart === key) return this.spendCache.summary;
    const summary: SpendSummary = { total: 0, bySource: { router: 0, agent: 0, builder: 0 } };
    try {
      const rows = db.prepare('SELECT source, SUM(cost_usd) AS cost FROM claude_usage WHERE date >= ? GROUP BY source').all(key) as { source: UsageSource; cost: number }[];
      for (const row of rows) {
        summary.bySource[row.source] = (summary.bySource[row.source] ?? 0) + (row.cost ?? 0);
        summary.total += row.cost ?? 0;
      }
    } catch (err: any) {
      Logger.warn('ClaudeUsage', `Failed to read cycle spend: ${err.message}`);
    }
    this.spendCache = { cycleStart: key, summary };
    return summary;
  }

  /** Spend not recorded yet but already committed (batch requests waiting for their results). */
  public static registerReservations(provider: () => SpendSummary): void {
    this.reservations.push(provider);
  }

  public static reserved(): SpendSummary {
    const out: SpendSummary = { total: 0, bySource: { router: 0, agent: 0, builder: 0 } };
    for (const provider of this.reservations) {
      const r = provider();
      out.total += r.total;
      for (const s of Object.keys(out.bySource) as UsageSource[]) out.bySource[s] += r.bySource[s] ?? 0;
    }
    return out;
  }

  public static day(date = new Date()): DayTotals {
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
               COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens, COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
               COALESCE(SUM(cost_usd), 0) AS costUsd
        FROM claude_usage WHERE date = ?
      `).get(utcDate(date)) as DayTotals;
      return row;
    } catch {
      return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 };
    }
  }

  /** Test helper: forget the cached cycle spend. */
  public static resetCache(): void {
    this.spendCache = null;
  }
}
