import { ClaudeCreditState } from './ClaudeCreditState';
import { claudeSettings } from './claudeSettings';
import type { UsageSource } from './ClaudeUsage';

/** Separate concurrency pools: agent loops must not take every slot of the server's own tasks. */
export type ClaudePool = 'router' | 'agents';

/** A reserved Claude call slot: released once, whatever happens to the call. */
export interface ClaudeTicket {
  pool: ClaudePool;
  source: UsageSource;
  /** This call is the probe after a credit or availability error */
  probe: boolean;
  release(): void;
}

const inFlight: Record<ClaudePool, number> = { router: 0, agents: 0 };

/**
 * Reserves a slot for a realtime call, or null when Claude is unavailable or every slot of the
 * pool is busy (the router then leaves the task queued). Synchronous: the router takes it while
 * scanning the queue, so the next task already sees the slot as used.
 */
export function tryAcquireClaude(pool: ClaudePool, source: UsageSource): ClaudeTicket | null {
  const settings = claudeSettings();
  const max = pool === 'router' ? settings.maxConcurrent : settings.agents.maxConcurrent;
  if (inFlight[pool] >= max) return null;
  const availability = ClaudeCreditState.availability(source);
  if (!availability.available) return null;
  if (availability.probe) ClaudeCreditState.beginProbe();
  inFlight[pool]++;
  let released = false;
  return {
    pool,
    source,
    probe: availability.probe,
    release: () => {
      if (released) return;
      released = true;
      inFlight[pool]--;
      if (availability.probe) ClaudeCreditState.endProbe();
    },
  };
}

export const claudeInFlight = (pool: ClaudePool) => inFlight[pool];
