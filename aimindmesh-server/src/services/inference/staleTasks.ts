import { NodeRegistry } from '../NodeRegistry';
import { InferenceRegistry } from '../InferenceRegistry';
import { Logger } from '../../utils/Logger';
import { ClaudeBatchQueue } from './claude/ClaudeBatchQueue';
import { isCloudTarget } from './providerIds';
import { routerState } from './routerState';
import type { TaskPayload } from './routerTypes';

export interface StaleTaskResets {
  /** Back to the AUTO list (the node it ran on went offline) */
  toAuto: (id: string, payload: TaskPayload, reason: string) => void;
  /** Moved to OpenRouter (processing for more than 24 h) */
  toOpenRouter: (id: string, payload: TaskPayload) => void;
}

/**
 * Periodic check of the PROCESSING tasks: zombies (no execution context for 10 min) fail, tasks
 * of an offline node go back to AUTO, tasks running for 24 h move to OpenRouter.
 */
export function checkStaleTasks(resets: StaleTaskResets): void {
  const activeTasks = InferenceRegistry.getActive().filter(t => t.status === 'PROCESSING');
  if (activeTasks.length === 0) return;

  const allNodes = NodeRegistry.getNodes().filter(n => n.status === 'ONLINE');
  const onlineNodes = new Set<string>();
  allNodes.forEach(n => {
    onlineNodes.add(n.id.toUpperCase());
    if (n.name) onlineNodes.add(n.name.toUpperCase());
  });

  for (const task of activeTasks) {
    // External tasks own their timeouts and their registry entry
    if (routerState.externalTasks.has(task.id)) continue;

    // --- Zombie Detection: PROCESSING in registry but no active execution context ---
    const hasController = routerState.activeAbortControllers.has(task.id);
    const hasPendingMobile = routerState.pendingMobileTasks.has(task.id);

    if (!hasController && !hasPendingMobile) {
      const ageMin = Math.round((Date.now() - (task.processingStartedAt || task.startedAt)) / 60000);

      // Detailed logging for debugging
      const controllerKeys = Array.from(routerState.activeAbortControllers.keys()).map(k => k.slice(0, 8));
      Logger.debug('InferenceRouter', `[STALE-CHECK] Task [${task.id.slice(0, 8)}] state: hasController=${hasController}, hasPendingMobile=${hasPendingMobile}, age=${ageMin}m. Map keys: ${controllerKeys.join(',')}`);

      // Safeguard: Kill zombies that have been in PROCESSING for >10 minutes without context
      // Mobile tasks are handled via their own 24h internal timeout.
      if (ageMin >= 10) {
        Logger.warn('InferenceRouter', `[STALE] Zombie task detected [${task.id.slice(0, 8)}] - PROCESSING with no context (${ageMin}m old). Marking FAILED.`);

        // Clear any locks held by this zombie task
        for (const [lockKey, lockInfo] of routerState.activeLocks.entries()) {
          if (lockInfo.id === task.id) {
            Logger.warn('InferenceRouter', `[STALE] Releasing lock ${lockKey} held by zombie task [${task.id.slice(0, 8)}]`);
            routerState.activeLocks.delete(lockKey);
          }
        }

        InferenceRegistry.finish(task.id, undefined, `Zombie task: execution context lost (age: ${ageMin}m)`);
        continue;
      }
    }

    // --- Node Offline Detection ---
    const target = (task.provider || task.model || '').toUpperCase();

    if (!isCloudTarget(target) && !onlineNodes.has(target)) {
      Logger.warn('InferenceRouter', `[STALE] Node [${target}] OFFLINE. Recovering task [${task.id.slice(0, 8)}]...`);
      const pending = routerState.pendingMobileTasks.get(task.id);
      if (pending) {
        pending.cleanup();
        pending.callback({ error: `NODE_${target}_OFFLINE` });
      } else if (task.payload) {
        resets.toAuto(task.id, task.payload, 'NODE_OFFLINE');
      } else {
        InferenceRegistry.setStatus(task.id, 'QUEUED');
      }
      continue;
    }

    // --- 24h Timeout & OpenRouter Fallback (a task waiting on a Claude batch has its own expiry) ---
    const ageMs = Date.now() - (task.processingStartedAt || task.startedAt);
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours >= 24 && !ClaudeBatchQueue.has(task.id)) {
      Logger.warn('InferenceRouter', `[STALE] Task [${task.id.slice(0, 8)}] exceeded 24h limit on [${target}]. Fallback to OPENROUTER.`);
      if (task.payload) {
        resets.toOpenRouter(task.id, task.payload);
      } else {
        InferenceRegistry.finish(task.id, undefined, 'Task timed out after 24h on local node');
      }
    }
  }
}
