import type { ClaudeStatus } from '../../../types/api';
import { ClaudeBatchQueue } from './ClaudeBatchQueue';
import { ClaudeCreditState } from './ClaudeCreditState';
import { claudeInFlight } from './claudeGate';
import { claudeSettings } from './claudeSettings';
import { ClaudeUsage, cycleBounds } from './ClaudeUsage';

/** Claude part of the admin status: availability, spend of the billing cycle, today's tokens. */
export function claudeStatus(now = new Date()): ClaudeStatus {
  const settings = claudeSettings();
  const { start, end } = cycleBounds(settings.billingCycleDay, now);
  const router = ClaudeCreditState.availability('router', {}, now);
  const agents = ClaudeCreditState.availability('agent', {}, now);
  const spent = ClaudeUsage.cycleSpend(start);
  const reserved = ClaudeUsage.reserved();
  return {
    enabled: settings.enabled,
    configured: !!settings.apiKey,
    state: router.state,
    reason: router.reason,
    nextProbeAt: router.retryAt && router.retryAt < Number.MAX_SAFE_INTEGER ? router.retryAt : undefined,
    agentsState: agents.state,
    agentsEnabled: settings.agents.enabled,
    cycle: {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      spendUsd: spent.total,
      reservedUsd: reserved.total,
      budgetUsd: settings.monthlyBudgetUsd,
      agentBudgetUsd: settings.agents.monthlyBudgetUsd,
      bySource: spent.bySource,
    },
    today: ClaudeUsage.day(now),
    inFlight: { router: claudeInFlight('router'), agents: claudeInFlight('agents') },
    pendingBatchRequests: ClaudeBatchQueue.pendingCount(),
  };
}
