import { Logger } from '../../utils/Logger';
import type { QueueItem } from './routerTypes';

const MAX_RETRIES = 5;

/**
 * Generic retry of a failed task (after the Claude and cooldown rules), applied to its payload:
 * - 'requeue': up to 5 retries; a stale-lock timeout on the local node escalates to GEMINI, a
 *   failed explicit node falls back to AUTO, GEMINI/OPENROUTER routing is kept;
 * - 'stalled': an EVOLUTION task that exhausted its retries waits for a manual retry;
 * - 'fail': anything else is rejected to its caller.
 */
export function planGenericRetry(item: QueueItem, err: any): 'requeue' | 'stalled' | 'fail' {
  const payload = item.payload;

  if ((payload.retryCount || 0) <= MAX_RETRIES) {
    payload.retryCount = (payload.retryCount || 0) + 1;

    const currentRouting = (payload.options?.routing || 'AUTO').toUpperCase();
    // If it's an explicit node (not AUTO, GEMINI, OPENROUTER), fall back to AUTO.
    // But if it's already GEMINI or OPENROUTER, KEEP IT.
    const isExplicitNode = !['AUTO', 'GEMINI', 'OPENROUTER'].includes(currentRouting);

    if (err.message?.includes('Stale lock timeout')) {
      if (currentRouting === 'SERVER_LOCAL' || currentRouting === 'AUTO' || item.lastProvider === 'SERVER_LOCAL') {
        if (!payload.options) payload.options = {};
        payload.options.routing = 'GEMINI';
        Logger.info('InferenceRouter', `[ESCALATION] Task [${item.id.slice(0, 8)}] timed out on Local node. Retrying with GEMINI.`);
      }
    } else if (isExplicitNode) {
      // Only clear routing if it was directed to a specific local node that failed
      payload.options = { ...payload.options, routing: 'AUTO' };
    }
    return 'requeue';
  }

  if (payload.type === 'EVOLUTION') {
    Logger.error('InferenceRouter', `[STALLED] Task [${item.id.slice(0, 8)}] exhausted ${MAX_RETRIES} retries. Marking as STALLED for manual intervention.`);
    return 'stalled';
  }
  return 'fail';
}
