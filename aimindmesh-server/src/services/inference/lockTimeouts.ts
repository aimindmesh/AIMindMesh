import type { EngineType } from '../InferenceRouter';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * How long a provider lock may be held before it is stale: the task is aborted (then
 * retried or escalated) and the target is freed for the rest of the queue.
 *
 * Independent from the HTTP timeouts in config.json (ollama.timeoutMs is 24h by default):
 * one hung request must not block every other task on that target for a day.
 * OPENCLAW outlives its bridge timeout (taskTimeoutMs, 1h); MOBILE keeps the 24h chosen
 * for phones that may be asleep.
 */
export const LOCK_TIMEOUT_MS: Record<EngineType, number> = {
  OLLAMA: 3 * HOUR,
  GEMINI: 15 * MINUTE,
  OPENROUTER: 15 * MINUTE,
  HERMES: 30 * MINUTE,
  OPENCLAW: 75 * MINUTE,
  MOBILE: 24 * HOUR,
  // Claude takes no provider lock (claudeGate bounds it): typed for completeness
  CLAUDE: 15 * MINUTE,
  CLAUDE_BATCH: 25 * HOUR,
};

/** A cloud lock with no running task behind it (leaked) is dropped after this grace. */
export const LEAKED_CLOUD_LOCK_MS = 2 * MINUTE;

export function lockTimeoutMs(engine: string): number {
  return LOCK_TIMEOUT_MS[engine as EngineType] ?? LOCK_TIMEOUT_MS.OLLAMA;
}

/** Engine part of a lock key (`TARGET:ENGINE`). */
export const lockEngine = (lockKey: string) => lockKey.slice(lockKey.lastIndexOf(':') + 1);
