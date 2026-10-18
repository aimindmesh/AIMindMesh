import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import { claudeKeyFingerprint } from './claudeClient';
import { claudeSettings } from './claudeSettings';
import { ClaudeUsage, cycleBounds, type UsageSource } from './ClaudeUsage';

/**
 * Whether Claude can take a call. Errors the API reports for the whole organization (no
 * credit, bad key, model not available) are persisted and block every caller; the internal
 * budget is computed from the recorded usage. After a credit or availability error, one probe
 * call is let through every `exhaustedRetryHours` (a refused call costs nothing), and a new
 * billing cycle clears the credit error.
 */
export type ClaudeState = 'ok' | 'no_key' | 'credit_exhausted' | 'budget_reached' | 'auth_error' | 'unavailable';
type BlockingState = 'credit_exhausted' | 'auth_error' | 'unavailable';

interface PersistedState {
  state: BlockingState;
  reason: string;
  since: number;
  retryAt: number;
  cycleStart: string;
  keyFingerprint: string;
}

export interface ClaudeAvailability {
  state: ClaudeState;
  available: boolean;
  /** The call that takes this availability is the probe after a blocking error */
  probe: boolean;
  reason?: string;
  retryAt?: number;
}

const SETTINGS_ID = 'claude_credit_state';

export class ClaudeCreditState {
  private static loaded = false;
  private static persisted: PersistedState | null = null;
  private static probeInFlight = false;

  private static load(): PersistedState | null {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const row = db.prepare('SELECT value FROM system_settings WHERE id = ?').get(SETTINGS_ID) as { value: string } | undefined;
        this.persisted = row ? JSON.parse(row.value) : null;
      } catch (err: any) {
        Logger.warn('ClaudeCreditState', `Failed to load state: ${err.message}`);
      }
    }
    return this.persisted;
  }

  private static save(state: PersistedState | null): void {
    this.persisted = state;
    try {
      if (state) {
        db.prepare('INSERT OR REPLACE INTO system_settings (id, value, updated_at) VALUES (?, ?, ?)')
          .run(SETTINGS_ID, JSON.stringify(state), new Date().toISOString());
      } else {
        db.prepare('DELETE FROM system_settings WHERE id = ?').run(SETTINGS_ID);
      }
    } catch (err: any) {
      Logger.warn('ClaudeCreditState', `Failed to save state: ${err.message}`);
    }
  }

  private static cycleStartKey(now = new Date()): string {
    return cycleBounds(claudeSettings().billingCycleDay, now).start.toISOString().slice(0, 10);
  }

  /** Blocking error still in force, or null (cleared by a new cycle or a new key). */
  private static blocking(now = new Date()): PersistedState | null {
    const p = this.load();
    if (!p) return null;
    const cleared =
      (p.state === 'credit_exhausted' && p.cycleStart !== this.cycleStartKey(now)) ||
      (p.state === 'auth_error' && p.keyFingerprint !== claudeKeyFingerprint());
    if (cleared) {
      Logger.info('ClaudeCreditState', `Claude ${p.state} cleared (${p.state === 'auth_error' ? 'new key' : 'new billing cycle'})`);
      this.save(null);
      return null;
    }
    return p;
  }

  /** Spend of the current cycle including reservations, against the global and agent budgets. */
  private static overBudget(source: UsageSource, now = new Date()): string | null {
    const settings = claudeSettings();
    const { start } = cycleBounds(settings.billingCycleDay, now);
    const spent = ClaudeUsage.cycleSpend(start);
    const reserved = ClaudeUsage.reserved();
    const total = spent.total + reserved.total;
    if (total >= settings.monthlyBudgetUsd) return `budget ${settings.monthlyBudgetUsd} USD reached (${total.toFixed(2)} USD)`;
    const agentCap = settings.agents.monthlyBudgetUsd;
    if (source !== 'router' && agentCap !== null) {
      const agents = spent.bySource.agent + spent.bySource.builder + reserved.bySource.agent + reserved.bySource.builder;
      if (agents >= agentCap) return `agent budget ${agentCap} USD reached (${agents.toFixed(2)} USD)`;
    }
    return null;
  }

  /**
   * Availability for one caller. `allowProbe: false` (batches) refuses the probe slot:
   * a batch would hold it for minutes.
   */
  public static availability(source: UsageSource = 'router', opts: { allowProbe?: boolean } = {}, now = new Date()): ClaudeAvailability {
    const settings = claudeSettings();
    if (!settings.enabled || !settings.apiKey) return { state: 'no_key', available: false, probe: false };
    const block = this.blocking(now);
    if (block) {
      const canProbe = block.state !== 'auth_error' && opts.allowProbe !== false && !this.probeInFlight && now.getTime() >= block.retryAt;
      return { state: block.state, available: canProbe, probe: canProbe, reason: block.reason, retryAt: block.retryAt };
    }
    const over = this.overBudget(source, now);
    if (over) return { state: 'budget_reached', available: false, probe: false, reason: over };
    return { state: 'ok', available: true, probe: false };
  }

  public static isAvailable(source: UsageSource = 'router', opts: { allowProbe?: boolean } = {}): boolean {
    return this.availability(source, opts).available;
  }

  /** Takes the probe slot (only one probe runs at a time). */
  public static beginProbe(): void {
    this.probeInFlight = true;
  }

  public static endProbe(): void {
    this.probeInFlight = false;
  }

  /** A call went through: any blocking error is over. */
  public static reportSuccess(): void {
    if (this.load()) {
      Logger.info('ClaudeCreditState', `Claude available again after ${this.persisted!.state}`);
      this.save(null);
    }
  }

  /** The API refused a call for the whole organization. */
  public static reportBlocking(state: BlockingState, reason: string, now = new Date()): void {
    const hours = claudeSettings().exhaustedRetryHours;
    const retryAt = state === 'auth_error' ? Number.MAX_SAFE_INTEGER : now.getTime() + hours * 3_600_000;
    Logger.warn('ClaudeCreditState', `Claude ${state}: ${reason}. ${state === 'auth_error' ? 'Waiting for a new key.' : `Next probe at ${new Date(retryAt).toISOString()}.`}`);
    this.save({ state, reason: reason.slice(0, 300), since: now.getTime(), retryAt, cycleStart: this.cycleStartKey(now), keyFingerprint: claudeKeyFingerprint() });
  }

  /** Test helper. */
  public static reset(): void {
    this.loaded = false;
    this.persisted = null;
    this.probeInFlight = false;
    this.save(null);
  }
}
