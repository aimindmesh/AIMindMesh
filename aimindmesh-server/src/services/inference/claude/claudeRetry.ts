import { Logger } from '../../../utils/Logger';
import type { QueueItem } from '../../InferenceRouter';
import { classifyClaudeError } from './claudeErrors';

export type ClaudeFailureAction = 'not_claude' | 'requeue' | 'reject';

/**
 * What the router does with a task Claude failed. Every Claude failure is handled here,
 * before the generic retry, so none can loop on Claude:
 * - a task routed AUTO never goes back to Claude: CLAUDE joins its skipProviders and it is
 *   re-queued on the next provider of its list (credit and budget errors also block Claude
 *   for everyone through ClaudeCreditState);
 * - a task routed explicitly to Claude is rejected: its caller chose Claude and decides.
 */
export function claudeFailureAction(item: QueueItem, err: unknown): ClaudeFailureAction {
  const last = item.lastProvider?.toUpperCase();
  if (last !== 'CLAUDE') return 'not_claude';

  const error = classifyClaudeError(err);
  const options = item.payload.options ?? (item.payload.options = {});
  const requested = (options.requestedRouting || 'AUTO').toUpperCase();

  if (requested === 'CLAUDE') {
    Logger.warn('InferenceRouter', `[CLAUDE] Task [${item.id.slice(0, 8)}] explicitly routed to Claude failed (${error.kind}): returned to the caller`);
    return 'reject';
  }

  options.skipProviders = Array.from(new Set([...(options.skipProviders ?? []), 'CLAUDE']));
  options.routing = 'AUTO';
  Logger.warn('InferenceRouter', `[CLAUDE] Task [${item.id.slice(0, 8)}] failed on Claude (${error.kind}): moving to the next provider`);
  return 'requeue';
}
