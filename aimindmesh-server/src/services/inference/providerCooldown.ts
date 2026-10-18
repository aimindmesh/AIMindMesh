import { config } from '../../config';
import { Logger } from '../../utils/Logger';
import type { TaskPayload } from '../InferenceRouter';

const MIN_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 3_600_000;
const GEMINI_DAILY_WAIT_MS = 3_600_000;

/** Doubles the task's previous wait, from 30 s up to 1 h. */
function backoff(payload: TaskPayload): number {
  const current = payload.currentWaitMs || MIN_BACKOFF_MS / 2;
  const waitMs = Math.max(MIN_BACKOFF_MS, Math.min(current * 2, MAX_BACKOFF_MS));
  payload.currentWaitMs = waitMs;
  return waitMs;
}

const FREELLMAPI_QUOTA = ['All models exhausted', 'routing_error', '429', 'rate limit'];
const FREELLMAPI_SERVICE = ['500', '503', '504', 'ECONNREFUSED', 'network error', 'timed out', 'timeout', 'unreachable', 'fetch failed'];
const GEMINI_DAILY = ['GEMINI_DAILY_QUOTA_EXCEEDED', 'GEMINI_DAILY_QUOTA_REACHED', 'QuotaFailure', 'PerDay'];
const GEMINI_SERVICE = ['500', '503', '504', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'];

const has = (msg: string, needles: string[]) => needles.some(n => msg.includes(n));

/**
 * Wait imposed by a provider on a failed task (quota, rate limit, busy service): the task goes
 * to WAITING and back in the queue on the same provider. Null when the error is not a cooldown.
 */
export function providerCooldownMs(item: { id: string; payload: TaskPayload; lastProvider?: string }, errMsg: string): number | null {
  const { id, payload } = item;
  const lastProvider = item.lastProvider?.toUpperCase();

  if (lastProvider === 'FREELLMAPI') {
    const isQuota = has(errMsg, FREELLMAPI_QUOTA);
    if (isQuota || has(errMsg, FREELLMAPI_SERVICE)) {
      const waitMs = backoff(payload);
      Logger.warn('InferenceRouter', `[FREELLMAPI] Rate limit or service busy hit (${isQuota ? 'Quota' : 'Service'}). Task [${id.slice(0, 8)}] put in COOLDOWN, waiting ${waitMs / 1000}s (Backoff).`);
      return waitMs;
    }
    return null;
  }

  if (lastProvider !== 'GEMINI') return null;

  if (has(errMsg, GEMINI_SERVICE)) {
    const waitMs = backoff(payload);
    Logger.warn('InferenceRouter', `[SERVICE] Gemini busy (503). Task [${id.slice(0, 8)}] waiting ${waitMs / 1000}s (Backoff).`);
    return waitMs;
  }
  if (has(errMsg, GEMINI_DAILY)) {
    Logger.warn('InferenceRouter', `[QUOTA] Gemini daily quota exhausted. Task [${id.slice(0, 8)}] waiting 1h.`);
    return GEMINI_DAILY_WAIT_MS;
  }

  const maxRetries = config.gemini?.maxRetries ?? 20;
  const isQuota = errMsg.includes('GEMINI_QUOTA_EXCEEDED') || errMsg.includes('429');
  if (isQuota && (payload.retryCount || 0) < maxRetries) {
    payload.retryCount = (payload.retryCount || 0) + 1;
    const retryAfterSeconds = parseFloat(errMsg.split(':')[1]) || 20;
    Logger.warn('InferenceRouter', `[QUOTA] Gemini 429 hit. Waiting ${retryAfterSeconds * 2 + 10}s before retry ${payload.retryCount}/${maxRetries}...`);
    return (retryAfterSeconds * 2 + 10) * 1000;
  }
  return null;
}
