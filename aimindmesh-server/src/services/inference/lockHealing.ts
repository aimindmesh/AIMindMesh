import { InferenceRegistry } from '../InferenceRegistry';
import { Logger } from '../../utils/Logger';
import { LEAKED_CLOUD_LOCK_MS, lockEngine, lockTimeoutMs } from './lockTimeouts';
import { isCloudLock } from './providerIds';
import { routerState } from './routerState';
import type { EngineType } from './routerTypes';

/**
 * Drops leaked provider locks. Ground truth: a lock is valid ONLY if there's an active
 * AbortController for some task in PROCESSING state that actually holds that lock. The set of
 * "active lock keys" is rebuilt from the running controllers to prevent null-provider
 * comparisons from clearing valid locks.
 */
export function healLeakedLocks(): void {
  const processingLockKeys = new Set<string>();
  // 1. Check local tasks (HTTP/Cloud)
  for (const [taskId] of routerState.activeAbortControllers.entries()) {
    const info = InferenceRegistry.get(taskId);
    if (info?.status === 'PROCESSING') {
      const tgt = (info.provider || 'SERVER_LOCAL').toUpperCase();
      // Determine engine type based on provider and payload
      let engineType: EngineType = 'OLLAMA';
      if (tgt === 'GEMINI' || tgt === 'GEMINI_API') engineType = 'GEMINI';
      else if (tgt === 'OPENROUTER' || tgt === 'OPENROUTER_API') engineType = 'OPENROUTER';
      else if (tgt === 'HERMES') engineType = 'HERMES';
      else if (tgt === 'OPENCLAW') engineType = 'OPENCLAW';
      else if (info.payload?.type === 'AGENTIC' || info.payload?.type === 'AGENTIC_TASK') engineType = 'OPENCLAW';

      processingLockKeys.add(`${tgt}:${engineType}`);
    }
  }
  // 2. Check mobile/external tasks (WebSocket)
  for (const [, pending] of routerState.pendingMobileTasks.entries()) {
    processingLockKeys.add(`${pending.node.toUpperCase()}:MOBILE`);
  }

  // 3. Check OpenClaw tasks (REST/WS Bridge)
  for (const [taskId] of routerState.activeAbortControllers.entries()) {
    const info = InferenceRegistry.get(taskId);
    if (info?.status === 'PROCESSING' && info.payload?.type === 'AGENTIC') {
      processingLockKeys.add(`OPENCLAW:AGENTIC`);
    }
  }

  const now = Date.now();
  for (const [lock, lockInfo] of routerState.activeLocks.entries()) {
    const gracePeriod = isCloudLock(lock) ? LEAKED_CLOUD_LOCK_MS : lockTimeoutMs(lockEngine(lock));

    if (now - lockInfo.timestamp > gracePeriod && !processingLockKeys.has(lock)) {
      Logger.warn('InferenceRouter', `[QUEUE] Force-clearing leaked lock: ${lock} (Held for ${Math.round((now - lockInfo.timestamp)/1000)}s)`);
      routerState.activeLocks.delete(lock);
    }
  }
}
