import { NodeRegistry } from './NodeRegistry';
import { config } from '../config';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import { SearchService } from './SearchService';
import { InferenceRegistry } from './InferenceRegistry';
import { InferenceProviders } from './InferenceProviders';
import { GeminiQueueManager } from './GeminiQueueManager';
import { lockTimeoutMs } from './inference/lockTimeouts';
import { dispatchToProvider } from './inference/providerDispatch';
import { providerCooldownMs } from './inference/providerCooldown';
import { flattenPrompt } from './inference/promptParts';
import { tryAcquireClaude } from './inference/claude/claudeGate';
import { claudeFailureAction } from './inference/claude/claudeRetry';
import { routerState } from './inference/routerState';
import { recoverQueueAfterRestart } from './inference/bootRecovery';
import { checkStaleTasks } from './inference/staleTasks';
import { healLeakedLocks } from './inference/lockHealing';
import { planGenericRetry } from './inference/retryPolicy';
import * as MobileNodes from './inference/mobileNodes';
import type { AbortReason, CompletionListener, EngineType, QueueItem, TaskPayload, TaskType } from './inference/routerTypes';
import crypto from 'crypto';

export type { EngineType, QueueItem, TaskPayload, TaskType } from './inference/routerTypes';

export class InferenceRouter {
  // Shared with the helper modules of src/services/inference (routerState.ts): never reassigned
  private static taskQueue = routerState.taskQueue;
  private static items = routerState.items;
  private static activeLocks = routerState.activeLocks;
  private static isScanningQueue = false;
  private static pausedTasks = routerState.pausedTasks;
  private static activeAbortControllers = routerState.activeAbortControllers;
  private static externalTasks = routerState.externalTasks;

  public static nodeSockets = routerState.nodeSockets;
  public static pendingMobileTasks = routerState.pendingMobileTasks;
  private static taskCompletionListeners = routerState.completionListeners;

  public static onTaskCompleted(listener: CompletionListener) {
    this.taskCompletionListeners.push(listener);
  }

  /** Registers a task run outside the queue: cancelTask and the brake call `cancel`, the stale check skips it. */
  public static trackExternalTask(id: string, cancel: () => void): void {
    this.externalTasks.set(id, cancel);
  }

  public static untrackExternalTask(id: string): void {
    this.externalTasks.delete(id);
  }

  public static clearLocks() {
    Logger.warn('InferenceRouter', `[ADMIN] Manual lock clearing triggered. Removed ${this.activeLocks.size} locks.`);
    this.activeLocks.clear();
    void this.processQueue();
  }


  public static async init(): Promise<void> {
    try {
      // Load Gemini rolling window from DB
      await GeminiQueueManager.init();

      // Prune old calls from DB
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      db.prepare('DELETE FROM gemini_calls WHERE timestamp <= ?').run(oneDayAgo);
      
      recoverQueueAfterRestart((task, id) => this._enqueueTask(task, id));
      // processQueue too: tasks blocked by a lock released here must not wait for the next event
      setInterval(() => { this.checkStaleTasks(); void this.processQueue(); }, 60000);
    } catch (err: any) { Logger.error('InferenceRouter', `Init failed: ${err.message}`); }
  }

  public static checkStaleTasks() {
    checkStaleTasks({
      toAuto: (id, payload, reason) => this._resetTaskToAuto(id, payload, reason),
      toOpenRouter: (id, payload) => this._resetTaskToOpenRouter(id, payload),
    });
  }

  private static _resetTaskToOpenRouter(id: string, payload: TaskPayload) {
    if (this.taskQueue.some(t => t.id === id)) return;
    
    // Abort current attempt
    this.activeAbortControllers.get(id)?.abort('RESET' satisfies AbortReason);
    
    InferenceRegistry.setStatus(id, 'QUEUED');
    InferenceRegistry.update(id, 'OPENROUTER');
    const newPayload = { ...payload, options: { ...payload.options, routing: 'OPENROUTER' } };
    InferenceRegistry.updatePayload(id, newPayload);
    this._requeue(id, newPayload);
  }

  private static _resetTaskToAuto(id: string, payload: TaskPayload, reason: string) {
    if (this.taskQueue.some(t => t.id === id)) return;
    this.activeAbortControllers.get(id)?.abort('RESET' satisfies AbortReason);
    InferenceRegistry.setStatus(id, 'QUEUED');
    InferenceRegistry.update(id, 'AUTO');
    this._requeue(id, { ...payload, options: { ...payload.options, routing: 'AUTO' } });
  }

  /**
   * Puts a task back in the queue with its caller's item (same promise). Without one (a task
   * recovered at boot whose promise is gone) the result only reaches the registry.
   */
  private static _requeue(id: string, payload: TaskPayload): void {
    const item = this.items.get(id) ?? {
      id,
      payload,
      resolve: (v: any) => InferenceRegistry.finish(id, v.response),
      reject: (e: any) => InferenceRegistry.finish(id, undefined, e.message),
    };
    item.payload = payload;
    this.taskQueue.push(item);
    void this.processQueue();
  }

  public static pauseTask(id: string): void { this.pausedTasks.add(id); InferenceRegistry.setStatus(id, 'PAUSED'); }
  public static resumeTask(id: string): void { this.pausedTasks.delete(id); InferenceRegistry.setStatus(id, 'QUEUED'); void this.processQueue(); }
  public static cancelTask(id: string): void {
    this.pausedTasks.delete(id);
    for (let i = this.taskQueue.length - 1; i >= 0; i--) {
      if (this.taskQueue[i].id === id) this.taskQueue.splice(i, 1);
    }
    // 1. Abort local/cloud request
    const controller = this.activeAbortControllers.get(id);
    if (controller) {
      controller.abort('CANCEL' satisfies AbortReason);
      this.activeAbortControllers.delete(id);
      Logger.info('InferenceRouter', `[ABORT] Aborted in-flight task [${id.slice(0, 8)}]`);
    }
    // 2. Abort mobile/external request
    const pending = this.pendingMobileTasks.get(id);
    if (pending) {
      // Notify the mobile node to stop its engine
      const socket = this.nodeSockets.get(pending.node.toUpperCase());
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'ABORT_TASK', id }));
      }
      pending.cleanup();
      pending.callback({ error: 'CANCELLED_BY_USER' });
      Logger.info('InferenceRouter', `[ABORT] Aborted mobile task [${id.slice(0, 8)}]`);
    }
    // 3. Abort a task run outside the queue (it releases its own resources)
    const external = this.externalTasks.get(id);
    if (external) {
      this.externalTasks.delete(id);
      external();
      Logger.info('InferenceRouter', `[ABORT] Cancelled external task [${id.slice(0, 8)}]`);
    }
    InferenceRegistry.finish(id, undefined, 'CANCELLED_BY_USER');
    // The caller stops waiting (its catch sees the cancellation)
    this.items.get(id)?.reject(new Error('CANCELLED_BY_USER'));
  }

  public static setBrake(active: boolean): void {
    config.infrastructureBrake = active;
    Logger.warn('InferenceRouter', `[BRAKE] Infrastructure Brake ${active ? 'ACTIVATED' : 'DEACTIVATED'}`);
    
    if (active) {
      // 1. Abort all active PROCESSING tasks
      for (const [id, controller] of this.activeAbortControllers.entries()) {
        Logger.info('InferenceRouter', `[BRAKE] Aborting task [${id.slice(0, 8)}] due to system brake`);
        controller.abort('BRAKE' satisfies AbortReason);
      }
      
      // 2. Clear mobile tasks
      for (const [id, pending] of this.pendingMobileTasks.entries()) {
        const socket = this.nodeSockets.get(pending.node.toUpperCase());
        if (socket && socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'ABORT_TASK', id }));
        }
        pending.cleanup();
        pending.callback({ error: 'SYSTEM_BRAKE_ACTIVE' });
      }
      
      // 3. Cancel the tasks run outside the queue: they cannot be resumed from a payload
      const externalIds = new Set(this.externalTasks.keys());
      for (const [id, cancel] of this.externalTasks.entries()) {
        Logger.info('InferenceRouter', `[BRAKE] Cancelling external task [${id.slice(0, 8)}] due to system brake`);
        cancel();
      }
      this.externalTasks.clear();

      // 4. Clear locks
      this.activeLocks.clear();
      
      // 5. Update registry: set all PROCESSING to QUEUED so they can resume later
      const activeTasks = InferenceRegistry.getActive();
      for (const task of activeTasks) {
        // An agent task payload is {repoId, repoName}, not a prompt: never re-inject it into the queue
        if (externalIds.has(task.id) || task.type === 'AGENT_TASK') continue;
        if (task.status === 'PROCESSING') {
          InferenceRegistry.setStatus(task.id, 'QUEUED');
          // Re-inject into memory queue if missing
          if (!this.taskQueue.some(t => t.id === task.id) && task.payload) {
            const item = this.items.get(task.id) ?? {
              id: task.id,
              payload: task.payload,
              resolve: (v: any) => InferenceRegistry.finish(task.id, v.response),
              reject: (e: any) => InferenceRegistry.finish(task.id, undefined, e.message)
            };
            item.payload = task.payload;
            this.taskQueue.push(item);
          }
        }
      }
    } else {
      // Trigger queue processing when brake is released
      void this.processQueue();
    }
  }


  public static updateQueuedTask(id: string, routing: string): boolean {
    const info = InferenceRegistry.get(id);
    if (!info) return false;
    // Agent runs are not prompts: they cannot move to another provider
    if (this.externalTasks.has(id) || info.type === 'AGENT_TASK') return false;

    const routingChanged = info.provider !== routing;
    const wasProcessing = info.status === 'PROCESSING';

    // 1. Update Registry & DB (Registry.updatePayload handles both)
    // An explicit re-route is a new request: the providers that failed the task may be tried again
    const newPayload = {
      ...info.payload,
      options: { ...(info.payload?.options || {}), routing, requestedRouting: routing.toUpperCase(), skipProviders: undefined }
    };
    InferenceRegistry.updatePayload(id, newPayload);

    if (wasProcessing && routingChanged) {
      Logger.warn('InferenceRouter', `[SYNC] Aborting PROCESSING task [${id.slice(0, 8)}] for re-routing from ${info.provider} to ${routing}`);
      // 1. Abort local/cloud request
      const controller = this.activeAbortControllers.get(id);
      if (controller) {
        controller.abort('REROUTE' satisfies AbortReason);
        // Do NOT delete from map here - let the original dispatch's finally block handle it
        // to prevent race conditions during immediate re-dispatching.
      }
      // 2. Abort mobile/external request
      const pending = this.pendingMobileTasks.get(id);
      if (pending) {
        const socket = this.nodeSockets.get(pending.node.toUpperCase());
        if (socket && socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'ABORT_TASK', id }));
        }
        pending.cleanup();
        pending.callback({ error: 'ABORTED_FOR_REROUTING' });
      }
      InferenceRegistry.setStatus(id, 'QUEUED');
    }

    // 2. Update in-memory queue
    const queueIdx = this.taskQueue.findIndex(t => t.id === id);
    if (queueIdx !== -1) {
      this.taskQueue[queueIdx].payload = newPayload;
      Logger.debug('InferenceRouter', `[SYNC] Memory queue updated for task [${id.slice(0, 8)}]`);
    } else if (wasProcessing || info.status === 'QUEUED' || info.status === 'PAUSED' || info.status === 'WAITING' || info.status === 'STALLED') {
      // Re-inject if it was processing or missing from queue but in a waitable state
      const item = this.items.get(id) ?? {
        id,
        payload: newPayload,
        resolve: (v: any) => InferenceRegistry.finish(id, v.response),
        reject: (e: any) => InferenceRegistry.finish(id, undefined, e.message)
      };
      item.payload = newPayload;
      this.taskQueue.push(item);
      Logger.debug('InferenceRouter', `[SYNC] Task [${id.slice(0, 8)}] re-injected into memory queue`);
    } else {
      return false; // Task is in a state where routing cannot be changed (e.g. COMPLETED/FAILED)
    }

    Logger.info('InferenceRouter', `Updated routing for task [${id.slice(0, 8)}] to: ${routing}`);
    void this.processQueue();
    return true;
  }

  private static async processQueue() {
    if (this.isScanningQueue || this.taskQueue.length === 0 || config.infrastructureBrake) return;
    this.isScanningQueue = true;
    try {
      healLeakedLocks();

      let i = 0;
      while (i < this.taskQueue.length) {
        const item = this.taskQueue[i];
        if (this.pausedTasks.has(item.id)) { i++; continue; }

        try {
          // Refresh payload from registry to catch any UI updates while queued
          const registryInfo = InferenceRegistry.get(item.id);
          if (registryInfo?.payload) {
            item.payload = registryInfo.payload;
          }

          const nodes = NodeRegistry.getNodes().filter(n => n.status === 'ONLINE');
          const { provider: target, engine } = InferenceProviders.resolveTarget(item.payload, nodes) as { provider: string, engine: EngineType };
          const tUpper = target.toUpperCase();
          const lockKey = `${tUpper}:${engine}`;

          // Rule: Per-Provider Serial Execution
          // We allow EMBEDDING and LIGHTWEIGHT tasks to bypass locks to prevent deadlocks during RAG/Search.
          const isEmbedding = ['EMBEDDING_GENERATION'].includes(item.payload.type);
          // Claude has no provider lock: its calls run side by side, bounded by the claudeGate slots
          const bypassLock = isEmbedding || engine === 'CLAUDE' || engine === 'CLAUDE_BATCH';

          if (!bypassLock && this.activeLocks.has(lockKey)) {
            const lockInfo = this.activeLocks.get(lockKey);
            // Self-healing: unlock if the lock is older than the engine's lock timeout
            const timeout = lockTimeoutMs(engine);
            if (lockInfo && (Date.now() - lockInfo.timestamp > timeout)) {
              const staleTaskId = lockInfo.id;
              Logger.warn('InferenceRouter', `[QUEUE] Forcibly releasing stale lock: ${lockKey} (Held by Task [${staleTaskId.slice(0, 8)}], running for >${timeout / 1000}s)`);

              // 1. Abort the associated task context
              const controller = this.activeAbortControllers.get(staleTaskId);
              if (controller) {
                controller.abort('STALE_LOCK' satisfies AbortReason);
                this.activeAbortControllers.delete(staleTaskId);
              }
              const mobilePending = this.pendingMobileTasks.get(staleTaskId);
              if (mobilePending) {
                mobilePending.cleanup();
                mobilePending.callback({ error: 'STALE_LOCK_TIMEOUT' });
                this.pendingMobileTasks.delete(staleTaskId);
              }

              // 2. Clear the lock
              this.activeLocks.delete(lockKey);
              // RETRY ESCALATION: We don't mark as FAILED here, we let the AbortError in _dispatchTask handle the retry
            } else {
              Logger.debug('InferenceRouter', `[QUEUE] Task [${item.id.slice(0, 8)}] BLOCKED by node lock: ${lockKey}`);
              i++;
              continue;
            }
          }

          if (engine === 'CLAUDE') {
            // Every slot busy (or Claude just became unavailable): the task stays queued for the next scan
            const ticket = tryAcquireClaude('router', 'router');
            if (!ticket) {
              Logger.debug('InferenceRouter', `[QUEUE] Task [${item.id.slice(0, 8)}] waiting for a Claude slot`);
              i++;
              continue;
            }
            item.claudeTicket = ticket;
          }

          Logger.info('InferenceRouter', `[QUEUE] DISPATCHING Task [${item.id.slice(0, 8)}] -> ${target} (${engine})`);
          // Atomic Lock & Status Update (MUST be synchronous to prevent race conditions)
          this.taskQueue.splice(i, 1);
          if (!bypassLock) {
            this.activeLocks.set(lockKey, { id: item.id, timestamp: Date.now() });
            Logger.debug('InferenceRouter', `[QUEUE] LOCK ACQUIRED: ${lockKey}`);
          }

          // Sync payload with resolved target ONLY at dispatch time to eliminate 'AUTO' once processing starts
          if (!item.payload.options) item.payload.options = {};
          item.payload.options.routing = target; // Forced overwrite

          Logger.info('InferenceRouter', `[QUEUE] SYNC: Task [${item.id.slice(0, 8)}] target set to ${target}`);
          InferenceRegistry.updatePayload(item.id, item.payload);
          InferenceRegistry.setStatus(item.id, 'PROCESSING');
          InferenceRegistry.updateProvider(item.id, target);
          InferenceRegistry.update(item.id, target); // Sync model field for UI compatibility

          // Register AbortController BEFORE dispatch
          const abortController = new AbortController();
          this.activeAbortControllers.set(item.id, abortController);
          Logger.debug('InferenceRouter', `[QUEUE] Registered controller for task [${item.id.slice(0, 8)}]. Total active: ${this.activeAbortControllers.size}`);

          void this._dispatchTask(item, target, engine, abortController);
          this.taskQueue.forEach((q, idx) => { if (!this.pausedTasks.has(q.id)) InferenceRegistry.setStatus(q.id, 'QUEUED', idx); });
        } catch (err: any) {
          Logger.error('InferenceRouter', `Routing resolution error: ${err.message}`);
          item.claudeTicket?.release();
          item.claudeTicket = undefined;
          i++;
        }
      }
    } finally { this.isScanningQueue = false; }
  }

  private static async _dispatchTask(item: QueueItem, target: string, engine: EngineType, controller: AbortController) {
    const { id, resolve, reject } = item;
    const signal = controller.signal;
    const lockKey = `${target.toUpperCase()}:${engine}`;
    let responseText = '';
    try {
      Logger.debug('InferenceRouter', `[_dispatchTask] Executing Task [${id.slice(0, 8)}]: Target=${target}, Engine=${engine}`);
      item.lastProvider = target;

      const payload = InferenceRegistry.get(id)?.payload || item.payload;
      const nodes = NodeRegistry.getNodes();
      const { url, model } = InferenceProviders.getProviderDetails(target, engine, nodes, config);

      Logger.debug('InferenceRouter', `[_dispatchTask] Resolved Payload: ${payload.type}, Engine: ${engine}, Search: ${payload.options?.searchEnabled}`);

      // 1. WEB SEARCH PRE-PROCESSING (Independent of provider), once: retries reuse the results
      if ((payload.type === 'WEB_RESEARCH' || payload.options?.searchEnabled) && payload.searchContext === undefined) {
        Logger.info('InferenceRouter', `[SEARCH] Pre-processing search for task [${id.slice(0, 8)}]`);
        const results = await SearchService.search(payload.prompt);
        payload.searchContext = SearchService.formatResultsForContext(results);
        InferenceRegistry.updatePayload(id, payload); // Stored for UI visibility and retries
      }

      // 2. PROVIDER DISPATCH
      responseText = await dispatchToProvider({
        id, target, engine, payload, prompt: flattenPrompt(payload), signal, url, model,
        onUpdate: item.onUpdate,
        claudeTicket: item.claudeTicket,
        dispatchMobile: () => MobileNodes.dispatchMobile(item, target),
        wakeup: () => MobileNodes.attemptWakeup(id, target),
      });

      // Execute post-completion listeners if successful
      if (responseText) {
        let listenerError: string | null = null;
        for (const listener of this.taskCompletionListeners) {
          try {
            await listener(id, responseText, item.payload.metadata, item.payload.type);
          } catch (e: any) {
            Logger.error('InferenceRouter', `Task listener failed for [${id.slice(0, 8)}]: ${e.message}`);
            listenerError = e.message;
          }
        }
        
        // Finalize status based on both inference AND listener success
        if (listenerError) {
          InferenceRegistry.finish(id, undefined, `PIPELINE_ERROR: ${listenerError}`);
          item.reject(new Error(`PIPELINE_ERROR: ${listenerError}`));
        } else {
          InferenceRegistry.finish(id, responseText);
          item.resolve({ provider: target, response: responseText });
        }
      } else {
        // Fallback for cases where responseText is somehow empty but no error was thrown
        item.resolve({ provider: target, response: '' });
      }

      void this.processQueue();
    } catch (err: any) {
      if (signal?.aborted) {
        // A stale lock kill is retried (escalated) here; a cancel, re-route, brake or reset already
        // re-queued or finished the task, and its new attempt may be running: never retry those
        if ((signal.reason as AbortReason) === 'STALE_LOCK') {
           Logger.warn('InferenceRouter', `[TIMEOUT] Task [${id.slice(0, 8)}] timed out on ${target}. Attempting escalation...`);
           if (this._attemptRetry(item, new Error('Stale lock timeout'))) return;
        }

        Logger.info('InferenceRouter', `[ABORT] Task [${id.slice(0, 8)}] aborted cleanly (${String(signal.reason)})`);
      } else if (!this._attemptRetry(item, err)) {
        item.reject(err);
      }
    } finally {
      item.claudeTicket?.release();
      item.claudeTicket = undefined;
      if (this.activeAbortControllers.get(id) === controller) {
        this.activeAbortControllers.delete(id);
      }
      if (this.activeLocks.get(lockKey)?.id === id) {
        this.activeLocks.delete(lockKey);
        Logger.debug('InferenceRouter', `[QUEUE] LOCK RELEASED: ${lockKey} by Task [${id.slice(0, 8)}]`);
      }
      void this.processQueue();
    }
  }

  /** Puts a failed task in WAITING and back in the queue after `waitMs`, unless it was moved or cancelled meanwhile. */
  private static _requeueAfter(item: QueueItem, waitMs: number): void {
    const { id } = item;
    InferenceRegistry.setStatus(id, 'WAITING');
    setTimeout(() => {
      const current = InferenceRegistry.get(id);
      if (current?.status === 'WAITING') {
        Logger.info('InferenceRouter', `[COOLDOWN] Cooldown finished. Re-queuing Task [${id.slice(0, 8)}].`);
        InferenceRegistry.setStatus(id, 'QUEUED');
        this.taskQueue.push(item);
        void this.processQueue();
      } else {
        Logger.info('InferenceRouter', `[COOLDOWN] Task [${id.slice(0, 8)}] no longer WAITING, skipping retry.`);
      }
    }, waitMs);
  }

  private static _attemptRetry(item: QueueItem, err: any): boolean {
    const payload = item.payload;
    const id = item.id;

    const errMsg = err.message || '';
    Logger.error('InferenceRouter', `[_attemptRetry] Task [${item.id.slice(0,8)}] failed on ${item.lastProvider}. Error: ${errMsg}`);

    // Claude failures never loop on Claude: next provider, or back to a caller that chose Claude
    const claudeAction = claudeFailureAction(item, err);
    if (claudeAction === 'reject') return false;
    if (claudeAction === 'requeue') {
      InferenceRegistry.updatePayload(id, payload);
      InferenceRegistry.setStatus(id, 'QUEUED');
      InferenceRegistry.updateProvider(id, 'AUTO');
      setImmediate(() => { this.taskQueue.push(item); void this.processQueue(); });
      return true;
    }

    // Quota, rate limit or busy service: wait, then retry on the same provider
    const cooldownMs = providerCooldownMs(item, errMsg);
    if (cooldownMs !== null) {
      this._requeueAfter(item, cooldownMs);
      return true;
    }

    const next = planGenericRetry(item, err);
    if (next === 'requeue') {
      InferenceRegistry.setStatus(item.id, 'QUEUED');
      InferenceRegistry.updateProvider(item.id, payload.options?.routing || 'AUTO');
      this.taskQueue.push(item);
      void this.processQueue();
      return true;
    }
    if (next === 'stalled') {
      // For EVOLUTION, keep in queue as STALLED instead of failing completely; unblock the caller
      InferenceRegistry.setStatus(item.id, 'STALLED');
      try {
        item.reject(new Error('TASK_STALLED: Exhausted retries. Manual intervention required.'));
      } catch (e: any) {
        Logger.error('InferenceRouter', `Error rejecting stalled task [${item.id.slice(0,8)}]: ${e.message}`);
      }
      return true;
    }
    return false;
  }

  public static async routeTask(task: TaskPayload, onUpdate?: (update: any) => void): Promise<{ provider: string, response: string }> {
    const id = crypto.randomUUID();
    if (!task.options?.requestedRouting) {
      task.options = { ...task.options, requestedRouting: (task.options?.routing || 'AUTO').toUpperCase() };
    }
    const title = task.options?.taskName || InferenceProviders.getDefaultTaskName(task.type);
    InferenceRegistry.register(id, task.type, title, task.options?.model, task, task.options?.routing || 'AUTO');
    try {
      const response = await this._enqueueTask(task, id, onUpdate);
      InferenceRegistry.finish(id, response.response);
      return response;
    } catch (err: any) {
      if (!err.message?.includes('TASK_STALLED')) {
        InferenceRegistry.finish(id, undefined, err.message);
      }
      throw err;
    } finally {
      void this.processQueue();
    }
  }

  private static async _enqueueTask(task: TaskPayload, id: string, onUpdate?: (update: any) => void): Promise<{ provider: string, response: string }> {
    while (this.pausedTasks.has(id)) await new Promise(r => setTimeout(r, 1000));

    return new Promise((resolve, reject) => {
      const item: QueueItem = {
        id,
        payload: task,
        onUpdate,
        resolve: (value) => { this.items.delete(id); resolve(value); },
        reject: (reason) => { this.items.delete(id); reject(reason); },
      };
      this.items.set(id, item);
      this.taskQueue.push(item);
      InferenceRegistry.setStatus(id, 'QUEUED', this.taskQueue.length - 1);
      void this.processQueue();
    });
  }

  public static async getEmbeddings(text: string): Promise<number[]> {
    const res = await this.routeTask({ prompt: text, type: 'EMBEDDING_GENERATION', options: { taskName: 'Vector Generation' } });
    return JSON.parse(res.response);
  }

  public static async complete(prompt: string, type: TaskType = 'GENERAL_CHAT', options?: TaskPayload['options'], metadata?: any): Promise<string> {
    const res = await this.routeTask({ prompt, type, tokensEstimate: prompt.length / 4, options, metadata });
    return res.response;
  }




  // Support for streaming tokens/thoughts back to the client
  public static onTaskUpdate(taskId: string, update: { type: 'token' | 'thinking', content: string }) {
    MobileNodes.onTaskUpdate(taskId, update);
  }

  /** Fails the tasks a disconnected node was processing so they can be retried or re-routed. */
  public static handleNodeDisconnection(nodeId: string): void {
    MobileNodes.handleNodeDisconnection(nodeId);
  }
}
