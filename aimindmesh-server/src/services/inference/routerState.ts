import type { CompletionListener, PendingMobileTask, QueueItem } from './routerTypes';

/**
 * State of the inference queue, shared by InferenceRouter and its helper modules (boot recovery,
 * stale check, lock healing, phone nodes): they all work on these same objects. Never reassign
 * a field: change the collections in place.
 */
export const routerState = {
  taskQueue: [] as QueueItem[],
  // The caller's own item per task (its promise): re-queueing after a brake, a re-route or a reset
  // must reuse it, or the caller waits forever
  items: new Map<string, QueueItem>(),
  // Lock structure: "TargetNodeID:ProviderName" -> holder and time
  activeLocks: new Map<string, { id: string, timestamp: number }>(),
  pausedTasks: new Set<string>(),
  // AbortController of every PROCESSING task: cancellation and re-routing go through it
  activeAbortControllers: new Map<string, AbortController>(),
  // Work the router did not dispatch (venture agent runs, validations): shown in the activity queue and
  // cancellable, but never zombie-killed, re-queued as a prompt or re-routed
  externalTasks: new Map<string, () => void>(),
  nodeSockets: new Map<string, any>(),
  pendingMobileTasks: new Map<string, PendingMobileTask>(),
  completionListeners: [] as CompletionListener[],
};
