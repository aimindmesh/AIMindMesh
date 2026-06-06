import { NodeRegistry } from './NodeRegistry';
import { sendToDevice } from './FCMDispatcher';
import { config } from '../config';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import * as OpenClawBridge from './OpenClawBridge';
import { HermesBridge } from './HermesBridge';
import { SearchService } from './SearchService';
import { InferenceRegistry } from './InferenceRegistry';
import { InferenceProviders } from './InferenceProviders';
import { GeminiQueueManager } from './GeminiQueueManager';
import crypto from 'crypto';

export type TaskType = 'EVOLUTION' | 'INTENT_CLASSIFICATION' | 'QUERY_EXPANSION' | 'CONCEPT_EXTRACTION' | 'CONCEPT_ENRICHMENT' | 'IMPROVEMENT_DETECTION' |
                       'PROACTIVE_INSIGHT' | 'DEBATE_PARTICIPATION' | 'DEBATE_SUMMARY' | 'INSIGHT_DEDUP' | 
                       'WIKI_SYNTHESIS' | 'WIKI_TOPIC_MAP' | 'CODE_EVOLUTION' | 'EVOLUTION_VALIDATION' |
                       'EMBEDDING_GENERATION' | 'GENERAL_CHAT' | 'WEB_RESEARCH' | 'AGENTIC_TASK' | 'SCHEDULED_TASK' |
                       'DIRECTIVES_EXTRACTION';
export type EngineType = 'OLLAMA' | 'GEMINI' | 'OPENROUTER' | 'MOBILE' | 'OPENCLAW' | 'HERMES';

export interface TaskPayload {
  type: TaskType;
  prompt: string;
  tokensEstimate?: number;
  currentWaitMs?: number;
  retryCount?: number;
  options?: {
    routing?: string;
    model?: string;
    thinking?: boolean;
    sessionKey?: string;
    searchEnabled?: boolean;
    taskName?: string;
  };
  metadata?: any;
}

const DEFAULT_AGENTIC_SESSION = 'aimindmesh:inference';

export class InferenceRouter {
  private static taskQueue: Array<{
    id: string;
    payload: TaskPayload;
    resolve: (value: { provider: string, response: string }) => void;
    reject: (reason: any) => void;
    lastProvider?: string;
    onUpdate?: (update: any) => void;
  }> = [];

  // Lock structure: "TargetNodeID:ProviderName" -> timestamp
  private static activeLocks = new Map<string, { id: string, timestamp: number }>();
  private static isScanningQueue = false;
  private static pausedTasks = new Set<string>();
  // AbortController per ogni task in PROCESSING - permette la cancellazione/re-routing
  private static activeAbortControllers = new Map<string, AbortController>();

  public static nodeSockets = new Map<string, any>();
  public static pendingMobileTasks = new Map<string, { callback: (result: any) => void, onUpdate?: (update: any) => void, cleanup: () => void, node: string }>();
  private static nodePenalties = new Map<string, number>();
  private static taskCompletionListeners: Array<(id: string, result: string, metadata: any, type: TaskType) => Promise<void>> = [];

  public static onTaskCompleted(listener: (id: string, result: string, metadata: any, type: TaskType) => Promise<void>) {
    this.taskCompletionListeners.push(listener);
  }

  public static clearLocks() {
    Logger.warn('InferenceRouter', `[ADMIN] Manual lock clearing triggered. Removed ${this.activeLocks.size} locks.`);
    this.activeLocks.clear();
    void this.processQueue();
  }


  public static async init(): Promise<void> {
    try {
      this.nodePenalties.clear();
      
      // Load Gemini rolling window from DB
      await GeminiQueueManager.init();

      // Prune old calls from DB
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      db.prepare('DELETE FROM gemini_calls WHERE timestamp <= ?').run(oneDayAgo);
      
      // Select PROCESSING tasks to determine their fate
      const procRows = db.prepare(`SELECT id, created_at FROM inference_queue WHERE status = 'PROCESSING'`).all() as any[];
      for (const row of procRows) {
        const ageMs = Date.now() - row.created_at;
        // If task was already processing for > 24h, mark as FAILED instead of re-queuing
        if (ageMs > 24 * 60 * 60 * 1000) {
          db.prepare(`UPDATE inference_queue SET status = 'FAILED', error_msg = 'Interrupted by restart and already exceeded 24h limit' WHERE id = ?`).run(row.id);
          Logger.warn('InferenceRouter', `Task [${row.id.slice(0, 8)}] discarded on boot: was already >24h old and in PROCESSING state.`);
        } else {
          db.prepare(`UPDATE inference_queue SET status = 'QUEUED' WHERE id = ?`).run(row.id);
        }
      }

      // IMPORTANT: Only recover RECENT tasks (< 24 hours old).
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const staleResult = db.prepare(`UPDATE inference_queue SET status = 'FAILED', error_msg = 'Discarded on restart: task too old' WHERE status = 'QUEUED' AND created_at < ?`).run(twentyFourHoursAgo);
      if (staleResult.changes > 0) Logger.warn('InferenceRouter', `Discarded ${staleResult.changes} stale tasks (older than 24h) on startup.`);

      const rows = db.prepare("SELECT * FROM inference_queue WHERE status = 'QUEUED' OR status = 'PROCESSING' OR status = 'WAITING' OR status = 'STALLED' OR status = 'PAUSED'").all() as any[];
      Logger.info('InferenceRouter', `Recovering ${rows.length} pending inferences...`);
      for (const row of rows) {
        try {
          const task = JSON.parse(row.payload) as TaskPayload;
          if (!task.options) task.options = {};
          InferenceRegistry.register(row.id, row.type, row.task_name, task.options?.model, task, task.options?.routing || 'AUTO');
          setTimeout(() => {
            this._enqueueTask(task, row.id).then(async (res) => {
              // 1. Run listeners first
              let listenerError: string | null = null;
              for (const listener of this.taskCompletionListeners) {
                try {
                  await listener(row.id, res.response, task.metadata, task.type);
                } catch (e: any) {
                  Logger.error('InferenceRouter', `Recovery listener failed for [${row.id.slice(0, 8)}]: ${e.message}`);
                  listenerError = e.message;
                }
              }
              // 2. Finalize status based on both inference AND listener success
              if (listenerError) {
                InferenceRegistry.finish(row.id, undefined, `LISTENER_FAILED: ${listenerError}`);
              } else {
                InferenceRegistry.finish(row.id, res.response);
              }
            }).catch(e => {
              InferenceRegistry.finish(row.id, undefined, e.message);
              Logger.warn('InferenceRouter', `Recovered task ${row.id} failed: ${e.message}`);
            });
          }, 5000);
        } catch (e) { Logger.warn('InferenceRouter', `Recovery parse failed for task ${row.id}`); }
      }
      setInterval(() => this.checkStaleTasks(), 60000);
    } catch (err: any) { Logger.error('InferenceRouter', `Init failed: ${err.message}`); }
  }

  public static checkStaleTasks() {
    const activeTasks = InferenceRegistry.getActive().filter(t => t.status === 'PROCESSING');
    if (activeTasks.length === 0) return;

    const allNodes = NodeRegistry.getNodes().filter(n => n.status === 'ONLINE');
    const onlineNodes = new Set<string>();
    allNodes.forEach(n => {
      onlineNodes.add(n.id.toUpperCase());
      if (n.name) onlineNodes.add(n.name.toUpperCase());
    });

    for (const task of activeTasks) {
      // --- Zombie Detection: PROCESSING in registry but no active execution context ---
      const hasController = this.activeAbortControllers.has(task.id);
      const hasPendingMobile = this.pendingMobileTasks.has(task.id);

      if (!hasController && !hasPendingMobile) {
        const ageMin = Math.round((Date.now() - (task.processingStartedAt || task.startedAt)) / 60000);

        // Detailed logging for debugging
        const controllerKeys = Array.from(this.activeAbortControllers.keys()).map(k => k.slice(0, 8));
        Logger.debug('InferenceRouter', `[STALE-CHECK] Task [${task.id.slice(0, 8)}] state: hasController=${hasController}, hasPendingMobile=${hasPendingMobile}, age=${ageMin}m. Map keys: ${controllerKeys.join(',')}`);

        // Safeguard: Kill zombies that have been in PROCESSING for >10 minutes without context
        // Mobile tasks are handled via their own 24h internal timeout.
        if (ageMin >= 10) {
          Logger.warn('InferenceRouter', `[STALE] Zombie task detected [${task.id.slice(0, 8)}] - PROCESSING with no context (${ageMin}m old). Marking FAILED.`);
          
          // Clear any locks held by this zombie task
          for (const [lockKey, lockInfo] of this.activeLocks.entries()) {
            if (lockInfo.id === task.id) {
              Logger.warn('InferenceRouter', `[STALE] Releasing lock ${lockKey} held by zombie task [${task.id.slice(0, 8)}]`);
              this.activeLocks.delete(lockKey);
            }
          }

          InferenceRegistry.finish(task.id, undefined, `Zombie task: execution context lost (age: ${ageMin}m)`);
          continue;
        }
      }

      // --- Node Offline Detection ---
      const target = (task.provider || task.model || '').toUpperCase();
      const isCloud = !target || target.includes('API') || target === 'AUTO' || target === 'GEMINI' || target === 'OPENROUTER' || target === 'OPENROUTER_API';

      if (!isCloud && !onlineNodes.has(target)) {
        Logger.warn('InferenceRouter', `[STALE] Node [${target}] OFFLINE. Recovering task [${task.id.slice(0, 8)}]...`);
        const pending = this.pendingMobileTasks.get(task.id);
        if (pending) {
          pending.cleanup();
          pending.callback({ error: `NODE_${target}_OFFLINE` });
        } else if (task.payload) {
          this._resetTaskToAuto(task.id, task.payload, 'NODE_OFFLINE');
        } else {
          InferenceRegistry.setStatus(task.id, 'QUEUED');
        }
        continue;
      }

      // --- 24h Timeout & OpenRouter Fallback ---
      const ageMs = Date.now() - (task.processingStartedAt || task.startedAt);
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours >= 24) {
        Logger.warn('InferenceRouter', `[STALE] Task [${task.id.slice(0, 8)}] exceeded 24h limit on [${target}]. Fallback to OPENROUTER.`);
        if (task.payload) {
          this._resetTaskToOpenRouter(task.id, task.payload);
        } else {
          InferenceRegistry.finish(task.id, undefined, 'Task timed out after 24h on local node');
        }
      }
    }
  }

  private static _resetTaskToOpenRouter(id: string, payload: TaskPayload) {
    if (this.taskQueue.some(t => t.id === id)) return;
    
    // Abort current attempt
    const controller = this.activeAbortControllers.get(id);
    if (controller) controller.abort();
    
    InferenceRegistry.setStatus(id, 'QUEUED');
    InferenceRegistry.update(id, 'OPENROUTER');
    const newPayload = { ...payload, options: { ...payload.options, routing: 'OPENROUTER' } };
    InferenceRegistry.updatePayload(id, newPayload);
    
    void this._enqueueTask(newPayload, id);
  }

  private static _resetTaskToAuto(id: string, payload: TaskPayload, reason: string) {
    if (this.taskQueue.some(t => t.id === id)) return;
    InferenceRegistry.setStatus(id, 'QUEUED');
    InferenceRegistry.update(id, 'AUTO');
    void this._enqueueTask({ ...payload, options: { ...payload.options, routing: 'AUTO' } }, id);
  }

  public static pauseTask(id: string): void { this.pausedTasks.add(id); InferenceRegistry.setStatus(id, 'PAUSED'); }
  public static resumeTask(id: string): void { this.pausedTasks.delete(id); InferenceRegistry.setStatus(id, 'QUEUED'); void this.processQueue(); }
  public static cancelTask(id: string): void {
    this.pausedTasks.delete(id);
    this.taskQueue = this.taskQueue.filter(i => i.id !== id);
    // 1. Abort local/cloud request
    const controller = this.activeAbortControllers.get(id);
    if (controller) {
      controller.abort();
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
    InferenceRegistry.finish(id, undefined, 'CANCELLED_BY_USER');
  }

  public static setBrake(active: boolean): void {
    config.infrastructureBrake = active;
    Logger.warn('InferenceRouter', `[BRAKE] Infrastructure Brake ${active ? 'ACTIVATED' : 'DEACTIVATED'}`);
    
    if (active) {
      // 1. Abort all active PROCESSING tasks
      for (const [id, controller] of this.activeAbortControllers.entries()) {
        Logger.info('InferenceRouter', `[BRAKE] Aborting task [${id.slice(0, 8)}] due to system brake`);
        controller.abort();
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
      
      // 3. Clear locks
      this.activeLocks.clear();
      
      // 4. Update registry: set all PROCESSING to QUEUED so they can resume later
      const activeTasks = InferenceRegistry.getActive();
      for (const task of activeTasks) {
        if (task.status === 'PROCESSING') {
          InferenceRegistry.setStatus(task.id, 'QUEUED');
          // Re-inject into memory queue if missing
          if (!this.taskQueue.some(t => t.id === task.id) && task.payload) {
             this.taskQueue.push({
               id: task.id,
               payload: task.payload,
               resolve: (v: any) => InferenceRegistry.finish(task.id, v.response),
               reject: (e: any) => InferenceRegistry.finish(task.id, undefined, e.message)
             });
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

    const routingChanged = info.provider !== routing;
    const wasProcessing = info.status === 'PROCESSING';

    // 1. Update Registry & DB (Registry.updatePayload handles both)
    const newPayload = {
      ...info.payload,
      options: { ...(info.payload?.options || {}), routing }
    };
    InferenceRegistry.updatePayload(id, newPayload);

    if (wasProcessing && routingChanged) {
      Logger.warn('InferenceRouter', `[SYNC] Aborting PROCESSING task [${id.slice(0, 8)}] for re-routing from ${info.provider} to ${routing}`);
      // 1. Abort local/cloud request
      const controller = this.activeAbortControllers.get(id);
      if (controller) {
        controller.abort();
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
      this.taskQueue.push({
        id,
        payload: newPayload,
        resolve: (v: any) => InferenceRegistry.finish(id, v.response),
        reject: (e: any) => InferenceRegistry.finish(id, undefined, e.message)
      });
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
      // --- SELF-HEALING LOCKS ---
      // Ground truth: a lock is valid ONLY if there's an active AbortController for some task in PROCESSING
      // state that actually holds that lock. We reconstruct the set of "active lock keys" from the
      // running controllers to prevent null-provider comparisons from clearing valid locks.
      const processingLockKeys = new Set<string>();
      // 1. Check local tasks (HTTP/Cloud)
      for (const [taskId] of this.activeAbortControllers.entries()) {
        const info = InferenceRegistry.get(taskId);
        if (info?.status === 'PROCESSING') {
          const tgt = (info.provider || 'SERVER_LOCAL').toUpperCase();
          const engine = info.payload?.options?.model ? 'OLLAMA' : 
                         (tgt === 'HERMES' ? 'HERMES' : 
                         (tgt === 'OPENCLAW' ? 'OPENCLAW' : 
                         (info.payload?.type === 'AGENTIC' || info.payload?.type === 'AGENTIC_TASK' ? 'OPENCLAW' : 'OLLAMA')));

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
      for (const [taskId, pending] of this.pendingMobileTasks.entries()) {
        processingLockKeys.add(`${pending.node.toUpperCase()}:MOBILE`);
      }
      
      // 3. Check OpenClaw tasks (REST/WS Bridge)
      for (const [taskId, controller] of this.activeAbortControllers.entries()) {
        const info = InferenceRegistry.get(taskId);
        if (info?.status === 'PROCESSING' && info.payload?.type === 'AGENTIC') {
          processingLockKeys.add(`OPENCLAW:AGENTIC`);
        }
      }

      const now = Date.now();
      for (const [lock, lockInfo] of this.activeLocks.entries()) {
        const isCloud = lock.includes('GEMINI') || lock.includes('OPENROUTER');
        const gracePeriod = isCloud ? 120000 : 24 * 60 * 60 * 1000; // 2 minutes for cloud, 24h for local/mobile

        if (now - lockInfo.timestamp > gracePeriod && !processingLockKeys.has(lock)) {
          Logger.warn('InferenceRouter', `[QUEUE] Force-clearing leaked lock: ${lock} (Held for ${Math.round((now - lockInfo.timestamp)/1000)}s)`);
          this.activeLocks.delete(lock);
        }
      }

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

          if (!isEmbedding && this.activeLocks.has(lockKey)) {
            const lockInfo = this.activeLocks.get(lockKey);
            // Self-healing: Unlock if lock is older than timeout (configurable, default 24h)
            const timeout = engine === 'MOBILE' ? 24 * 60 * 60 * 1000 : (config.ollama?.timeoutMs || 86400000);
            if (lockInfo && (Date.now() - lockInfo.timestamp > timeout)) {
              const staleTaskId = lockInfo.id;
              Logger.warn('InferenceRouter', `[QUEUE] Forcibly releasing stale lock: ${lockKey} (Held by Task [${staleTaskId.slice(0, 8)}], running for >${timeout / 1000}s)`);

              // 1. Abort the associated task context
              const controller = this.activeAbortControllers.get(staleTaskId);
              if (controller) {
                controller.abort();
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

          Logger.info('InferenceRouter', `[QUEUE] DISPATCHING Task [${item.id.slice(0, 8)}] -> ${target} (${engine})`);
          // Atomic Lock & Status Update (MUST be synchronous to prevent race conditions)
          this.taskQueue.splice(i, 1);
          if (!isEmbedding) {
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
          i++;
        }
      }
    } finally { this.isScanningQueue = false; }
  }

  private static async _dispatchTask(item: { id: string, payload: TaskPayload, resolve: any, reject: any, lastProvider?: string, onUpdate?: (update: any) => void }, target: string, engine: EngineType, controller: AbortController) {
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

      // 1. WEB SEARCH PRE-PROCESSING (Independent of provider)
      if (payload.type === 'WEB_RESEARCH' || payload.options?.searchEnabled) {
        Logger.info('InferenceRouter', `[SEARCH] Pre-processing search for task [${id.slice(0, 8)}]`);
        const results = await SearchService.search(payload.prompt);
        
        // --- IMPROVED SEARCH INJECTION ---
        const searchContext = SearchService.formatResultsForContext(results);
        const systemInstruction = `
### SYSTEM INSTRUCTION
You have access to real-time web search results provided below. 
1. Use the [Search Results] to provide an accurate, up-to-date answer.
2. If the results contain the answer, prioritize them over your internal knowledge.
3. Use citations like [1], [2] based on the result indices.
4. If results are irrelevant, acknowledge them but rely on your internal knowledge if possible.
5. Tone: Helpful, precise, and objective.

[Search Results]
${searchContext}
### END SYSTEM INSTRUCTION
`;
        payload.prompt = `${systemInstruction}\n\nUSER: ${payload.prompt}`;
        InferenceRegistry.updatePayload(id, payload); // Update stored prompt for UI visibility
      }

      // 2. PROVIDER DISPATCH
      if (target.toUpperCase() === 'FREELLMAPI') {
        const model = payload.options?.model || config.freellmapi?.model || 'auto';
        Logger.info('InferenceRouter', `[FREELLMAPI] DISPATCH: Task [${id.slice(0, 8)}] -> FreeLLMAPI (Model: ${model})`);
        responseText = await InferenceProviders.callFreeLLMAPI(payload.prompt, signal, model);
        this._trackUsage('openrouter'); // Fallback to OpenRouter usage table for now
      } else if (engine === 'GEMINI') {
        Logger.info('InferenceRouter', `[CLOUD] DISPATCH: Task [${id.slice(0, 8)}] -> Gemini (Model: ${payload.options?.model || config.gemini.model})`);
        responseText = await GeminiQueueManager.enqueue(payload.prompt, signal, payload.options?.model, config.gemini.apiKey);
        this._trackUsage('gemini', config.gemini.apiKey);
      } else if (engine === 'OPENROUTER') {
        const model = payload.options?.model || config.openrouter.model;
        Logger.info('InferenceRouter', `[CLOUD] DISPATCH: Task [${id.slice(0, 8)}] -> OpenRouter (Model: ${model})`);
        responseText = await InferenceProviders.callOpenRouter(payload.prompt, signal, payload.options?.model);
        this._trackUsage('openrouter');
      } else if (engine === 'HERMES' || target.toUpperCase() === 'HERMES') {
        Logger.info('InferenceRouter', `[HERMES] DISPATCH: Task [${id.slice(0, 8)}] -> Nous Research Hermes Agent`);
        const res = await HermesBridge.runAgentTask(payload.prompt, payload.options?.sessionKey ?? 'system');
        responseText = res.reply;
      } else if (engine === 'OPENCLAW' || target.toUpperCase() === 'OPENCLAW' || (payload.type === 'AGENTIC_TASK' && await OpenClawBridge.isReachable())) {
        const openClawKey = process.env.GOOGLE_API_KEY;
        const cost = 5;
        if (!GeminiQueueManager.hasCapacity(cost, openClawKey)) {
          Logger.warn('InferenceRouter', `[QUOTA] Agentic task [${id.slice(0, 8)}] postponed: OpenClaw Gemini quota near limit.`);
          throw new Error('GEMINI_DAILY_QUOTA_REACHED');
        }
        GeminiQueueManager.reserveCapacity(cost, openClawKey);
        const res = await OpenClawBridge.runAgentTask(payload.prompt, payload.options?.sessionKey ?? 'system');
        responseText = res.reply;

      } else if (payload.type === 'EMBEDDING_GENERATION') {
        responseText = JSON.stringify(await InferenceProviders.getEmbeddings(url!, payload.prompt));
      } else if (engine === 'MOBILE' || url === 'MOBILE_NODE') {
        responseText = await this._dispatchMobile(item, target) as string;
      } else if (url) {
        const thinking = payload.options?.thinking ? '\n\n(Think deeply.)' : '\n\n(Direct response.)';
        responseText = await InferenceProviders.callOllama(url, payload.prompt + thinking, model, signal);
      } else {
        await this._attemptWakeup(id, target);
        throw new Error(`NODE_${target}_OFFLINE`);
      }

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
        // Check if this was a stale lock timeout kill
        const lockInfo = this.activeLocks.get(lockKey); // Might be gone, check registry
        const timeout = engine === 'MOBILE' ? 24 * 60 * 60 * 1000 : (config.ollama?.timeoutMs || 86400000);
        const taskEntry = InferenceRegistry.get(id);
        
        // If it was aborted and it's taking too long, it's likely a timeout-triggered kill
        if (taskEntry && taskEntry.status === 'PROCESSING') {
           Logger.warn('InferenceRouter', `[TIMEOUT] Task [${id.slice(0, 8)}] likely timed out on ${target}. Attempting escalation...`);
           if (this._attemptRetry(item, new Error('Stale lock timeout'))) return;
        }

        // Task was cancelled/re-routed - do NOT retry, just clean up
        Logger.info('InferenceRouter', `[ABORT] Task [${id.slice(0, 8)}] aborted cleanly`);
        // Do not call reject - the task was re-injected by updateQueuedTask
      } else if (!this._attemptRetry(item, err)) {
        item.reject(err);
      }
    } finally {
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

  private static _trackUsage(provider: 'gemini' | 'openrouter', apiKey?: string): void {
    try {
      const now = Date.now();
      const today = new Date().toISOString().split('T')[0];
      const table = provider === 'gemini' ? 'gemini_usage' : 'openrouter_usage';
      db.prepare(`
        INSERT INTO ${table} (date, call_count) VALUES (?, 1)
        ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1
      `).run(today);

      if (provider === 'gemini') {
        GeminiQueueManager.trackCall(apiKey);
      }
      
      Logger.debug('InferenceRouter', `[USAGE] ${provider} call tracked (${today})`);
    } catch (err: any) {
      Logger.warn('InferenceRouter', `[USAGE] Failed to track ${provider} usage: ${err.message}`);
    }
  }


  private static async _dispatchMobile(item: { id: string, payload: TaskPayload, resolve: any, reject: any, onUpdate?: (update: any) => void }, provider: string) {
    const { id, payload } = item;
    const socket = this.nodeSockets.get(provider);
    if (!socket || socket.readyState !== 1) throw new Error(`NODE_${provider}_DISCONNECTED`);

    return new Promise((res, rej) => {
      // 24 hours timeout for mobile nodes - user requested long duration
      const timeout = setTimeout(() => { cleanup(); rej(new Error('Mobile timeout after 24h')); }, 24 * 60 * 60 * 1000);
      const onDisconnect = () => { cleanup(); rej(new Error(`NODE_${provider}_DISCONNECTED`)); };
      const cleanup = () => {
        clearTimeout(timeout);
        this.pendingMobileTasks.delete(id);
      };

      this.pendingMobileTasks.set(id, {
        callback: (result: any) => { cleanup(); if (result.error) rej(new Error(result.error)); else res(result.reply || ''); },
        onUpdate: item.onUpdate,
        cleanup,
        node: provider
      });

      socket.once?.('close', onDisconnect);
      socket.send(JSON.stringify({ type: 'task', id, payload }));
    });
  }

  private static async _attemptWakeup(id: string, provider: string) {
    const node = NodeRegistry.getNodes().find(n => n.id === provider);
    if (node?.fcm_token) {
      await sendToDevice(node.fcm_token, { title: 'Synaptic Link', body: 'Waking up node...', data: { type: 'WAKE_FOR_INFERENCE', taskId: id } });
    }
  }

  private static _attemptRetry(item: { id: string, payload: TaskPayload, resolve: any, reject: any, lastProvider?: string }, err: any): boolean {
    const payload = item.payload;
    const id = item.id;
    if (item.lastProvider) this.nodePenalties.set(item.lastProvider.toUpperCase(), Date.now() + 60000);

    const errMsg = err.message || '';
    const isGeminiQuota = errMsg.includes('GEMINI_QUOTA_EXCEEDED') || errMsg.includes('429');
    const isGeminiDaily = errMsg.includes('GEMINI_DAILY_QUOTA_EXCEEDED') || errMsg.includes('GEMINI_DAILY_QUOTA_REACHED') || errMsg.includes('QuotaFailure') || errMsg.includes('PerDay');
    
    Logger.error('InferenceRouter', `[_attemptRetry] Task [${item.id.slice(0,8)}] failed on ${item.lastProvider}. Error: ${errMsg}`);

    const lastProvUpper = item.lastProvider?.toUpperCase();

    // FreeLLMAPI Cooldown and Exponential Backoff
    const isFreeLLMAPIQuota = errMsg.includes('All models exhausted') || 
                              errMsg.includes('routing_error') || 
                              errMsg.includes('429') || 
                              errMsg.includes('rate limit');
                              
    const isFreeLLMAPIService = errMsg.includes('500') || 
                                errMsg.includes('503') || 
                                errMsg.includes('504') || 
                                errMsg.includes('ECONNREFUSED') || 
                                errMsg.includes('network error') ||
                                errMsg.includes('timed out') ||
                                errMsg.includes('timeout') ||
                                errMsg.includes('unreachable') ||
                                errMsg.includes('fetch failed');

    if (lastProvUpper === 'FREELLMAPI' && (isFreeLLMAPIQuota || isFreeLLMAPIService)) {
      const minWait = 30000; // 30s
      const maxWait = 3600000; // 1h
      let currentWait = payload.currentWaitMs || (minWait / 2);
      let waitMs = Math.min(currentWait * 2, maxWait);
      if (waitMs < minWait) waitMs = minWait;
      payload.currentWaitMs = waitMs;

      Logger.warn(
        'InferenceRouter', 
        `[FREELLMAPI] Rate limit or service busy hit (${isFreeLLMAPIQuota ? 'Quota' : 'Service'}). ` +
        `Task [${id.slice(0, 8)}] put in COOLDOWN, waiting ${waitMs / 1000}s (Backoff).`
      );

      InferenceRegistry.setStatus(id, 'WAITING');

      setTimeout(() => {
        const current = InferenceRegistry.get(id);
        if (current && current.status === 'WAITING') {
          Logger.info('InferenceRouter', `[FREELLMAPI] Cooldown finished. Re-queuing Task [${id.slice(0, 8)}].`);
          InferenceRegistry.setStatus(id, 'QUEUED');
          this.taskQueue.push(item);
          void this.processQueue();
        } else {
          Logger.info('InferenceRouter', `[FREELLMAPI] Task [${id.slice(0, 8)}] no longer WAITING, skipping retry.`);
        }
      }, waitMs);
      
      return true;
    }

    const isGeminiService = errMsg.includes('500') || errMsg.includes('503') || errMsg.includes('504') || errMsg.includes('UNAVAILABLE') || errMsg.includes('INTERNAL') || errMsg.includes('DEADLINE_EXCEEDED');

    if (lastProvUpper === 'GEMINI' && (isGeminiDaily || isGeminiService)) {
      let waitMs = 3600000; // Default 1h for Daily quota
      
      if (isGeminiService) {
        // Exponential Backoff for 503: start 30s, double each time up to 1h
        const minWait = 30000; // 30s
        const maxWait = 3600000; // 1h
        let currentWait = payload.currentWaitMs || (minWait / 2);
        waitMs = Math.min(currentWait * 2, maxWait);
        if (waitMs < minWait) waitMs = minWait;
        payload.currentWaitMs = waitMs;
        Logger.warn('InferenceRouter', `[SERVICE] Gemini busy (503). Task [${id.slice(0,8)}] waiting ${waitMs/1000}s (Backoff).`);
      } else {
        Logger.warn('InferenceRouter', `[QUOTA] Gemini daily quota exhausted. Task [${id.slice(0,8)}] waiting 1h.`);
      }

      InferenceRegistry.setStatus(id, 'WAITING');

      setTimeout(() => {
        const current = InferenceRegistry.get(id);
        if (current?.status === 'WAITING') {
          InferenceRegistry.setStatus(id, 'QUEUED');
          this.taskQueue.push(item);
          void this.processQueue();
        }
      }, waitMs);
      return true;
    }

    // Special handling for Gemini 429
    const maxRetries = config.gemini?.maxRetries ?? 20;
    if (isGeminiQuota && lastProvUpper === 'GEMINI' && (payload.retryCount || 0) < maxRetries) {
      payload.retryCount = (payload.retryCount || 0) + 1;
      const retryAfterSeconds = parseFloat(errMsg.split(':')[1]) || 20;
      const waitMs = (retryAfterSeconds * 2 + 10) * 1000;
      
      Logger.warn('InferenceRouter', `[QUOTA] Gemini 429 hit. Waiting ${retryAfterSeconds * 2 + 10}s before retry ${payload.retryCount}/${maxRetries}...`);
      InferenceRegistry.setStatus(id, 'WAITING');
      
      setTimeout(() => {
        // Check if task is still in WAITING state (user might have changed target or cancelled)
        const current = InferenceRegistry.get(id);
        if (current && current.status === 'WAITING') {
          InferenceRegistry.setStatus(id, 'QUEUED');
          this.taskQueue.push(item);
          void this.processQueue();
        } else {
          Logger.info('InferenceRouter', `[QUOTA] Task [${id.slice(0, 8)}] no longer WAITING, skipping Gemini retry.`);
        }
      }, waitMs);
      
      return true;
    }

    if ((payload.retryCount || 0) <= 5) {
      payload.retryCount = (payload.retryCount || 0) + 1;
      
      const currentRouting = (payload.options?.routing || 'AUTO').toUpperCase();
      // If it's an explicit node (not AUTO, GEMINI, OPENROUTER), fall back to AUTO.
      // But if it's already GEMINI or OPENROUTER, KEEP IT.
      const isExplicitNode = !['AUTO', 'GEMINI', 'OPENROUTER'].includes(currentRouting);

      // Escalation logic for timeouts or rate limits
      const errLower = err.message?.toLowerCase() || '';
      const isRateLimit = errLower.includes('quota exceeded') || errLower.includes('429') || errLower.includes('limit reached');

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

      InferenceRegistry.setStatus(item.id, 'QUEUED');
      InferenceRegistry.updateProvider(item.id, payload.options?.routing || 'AUTO');
      this.taskQueue.push(item);
      void this.processQueue();
      return true;
    } else if (payload.type === 'EVOLUTION') {
      // For EVOLUTION, keep in queue as STALLED instead of failing completely
      Logger.error('InferenceRouter', `[STALLED] Task [${item.id.slice(0, 8)}] exhausted 5 retries. Marking as STALLED for manual intervention.`);
      InferenceRegistry.setStatus(item.id, 'STALLED');
      
      // Unblock the caller but with a specific error message
      const stallError = new Error('TASK_STALLED: Exhausted retries. Manual intervention required.');
      // Avoid triggering unhandled rejection if the caller isn't listening anymore
      // or if it's a recovered task.
      try {
        item.reject(stallError);
      } catch (e: any) {
        Logger.error('InferenceRouter', `Error rejecting stalled task [${item.id.slice(0,8)}]: ${e.message}`);
      }
      return true; 
    }
    return false;
  }

  public static async routeTask(task: TaskPayload, onUpdate?: (update: any) => void): Promise<{ provider: string, response: string }> {
    const id = crypto.randomUUID();
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
      this.taskQueue.push({ id, payload: task, resolve, reject, onUpdate });
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
    const task = this.pendingMobileTasks.get(taskId);
    if (task && task.onUpdate) {
      task.onUpdate(update);
    }
  }

  /**
   * Handle node disconnection: fail all tasks that were being processed by this node
   * so they can be retried or re-routed.
   */
  public static handleNodeDisconnection(nodeId: string): void {
    const nodeUpper = nodeId.toUpperCase();
    const tasksToRecover: string[] = [];

    // Find all tasks assigned to this node in our pending map
    for (const [id, pending] of this.pendingMobileTasks.entries()) {
      if (pending.node.toUpperCase() === nodeUpper) {
        tasksToRecover.push(id);
      }
    }

    if (tasksToRecover.length === 0) return;

    Logger.warn('InferenceRouter', `[SYNC] Node [${nodeUpper}] disconnected. Recovering ${tasksToRecover.length} processing tasks...`);

    for (const id of tasksToRecover) {
      const pending = this.pendingMobileTasks.get(id);
      if (pending) {
        // Trigger failure on the pending promise so it can retry
        pending.callback({ error: `NODE_DISCONNECTED: Worker ${nodeUpper} went offline during processing` });
        this.pendingMobileTasks.delete(id);
      }
    }
  }

}