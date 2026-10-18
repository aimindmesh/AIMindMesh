import { config } from '../../config';
import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import * as OpenClawBridge from '../OpenClawBridge';
import { HermesBridge } from '../HermesBridge';
import { InferenceProviders } from '../InferenceProviders';
import { GeminiQueueManager } from '../GeminiQueueManager';
import type { EngineType, TaskPayload } from '../InferenceRouter';
import { promptParts } from './promptParts';
import { callClaude } from './claude/ClaudeProvider';
import { ClaudeError } from './claude/claudeErrors';
import type { ClaudeTicket } from './claude/claudeGate';
import { ClaudeBatchQueue } from './claude/ClaudeBatchQueue';

/** One provider call of the router: everything the provider chain needs, nothing of the queue. */
export interface DispatchRequest {
  id: string;
  target: string;
  engine: EngineType;
  payload: TaskPayload;
  /** Final prompt (search context already applied) */
  prompt: string;
  signal: AbortSignal;
  url: string | null;
  model?: string;
  onUpdate?: (update: any) => void;
  /** Claude slot reserved by the queue for engine CLAUDE */
  claudeTicket?: ClaudeTicket;
  /** Sends the task to a phone node over its socket (router state) */
  dispatchMobile: () => Promise<string>;
  /** Wakes an offline node through FCM (router state) */
  wakeup: () => Promise<void>;
}

/** Calls the provider the router resolved for a task and returns its text. */
export async function dispatchToProvider(req: DispatchRequest): Promise<string> {
  const { id, target, engine, payload, prompt, signal, url, model } = req;
  const targetUpper = target.toUpperCase();

  if (engine === 'CLAUDE') {
    if (!req.claudeTicket) throw new ClaudeError('transient', 'no Claude slot reserved');
    Logger.info('InferenceRouter', `[CLAUDE] DISPATCH: Task [${id.slice(0, 8)}] -> Claude (${payload.type})`);
    return callClaude({
      ticket: req.claudeTicket,
      taskType: payload.type,
      parts: promptParts(payload),
      model: payload.options?.model,
      thinking: payload.options?.thinking,
      // A caller that streams (phone chats) gets the reasoning summary when it asked for thinking
      showThinking: !!req.onUpdate && !!payload.options?.thinking,
      signal,
      onUpdate: req.onUpdate,
    });
  }
  if (engine === 'CLAUDE_BATCH') {
    Logger.info('InferenceRouter', `[CLAUDE] BATCH: Task [${id.slice(0, 8)}] -> Claude Message Batches (${payload.type})`);
    return ClaudeBatchQueue.submitAndWait(id, {
      taskType: payload.type,
      parts: promptParts(payload),
      model: payload.options?.model,
      thinking: payload.options?.thinking,
    }, signal);
  }
  if (targetUpper === 'FREELLMAPI') {
    const freeModel = payload.options?.model || config.freellmapi?.model || 'auto';
    Logger.info('InferenceRouter', `[FREELLMAPI] DISPATCH: Task [${id.slice(0, 8)}] -> FreeLLMAPI (Model: ${freeModel})`);
    const text = await InferenceProviders.callFreeLLMAPI(prompt, signal, freeModel);
    trackUsage('openrouter'); // Fallback to OpenRouter usage table for now
    return text;
  }
  if (engine === 'GEMINI') {
    Logger.info('InferenceRouter', `[CLOUD] DISPATCH: Task [${id.slice(0, 8)}] -> Gemini (Model: ${payload.options?.model || config.gemini.model})`);
    const text = await GeminiQueueManager.enqueue(prompt, signal, payload.options?.model, config.gemini.apiKey);
    trackUsage('gemini', config.gemini.apiKey);
    return text;
  }
  if (engine === 'OPENROUTER') {
    const routerModel = payload.options?.model || config.openrouter.model;
    Logger.info('InferenceRouter', `[CLOUD] DISPATCH: Task [${id.slice(0, 8)}] -> OpenRouter (Model: ${routerModel})`);
    const text = await InferenceProviders.callOpenRouter(prompt, signal, payload.options?.model);
    trackUsage('openrouter');
    return text;
  }
  if (engine === 'HERMES' || targetUpper === 'HERMES') {
    Logger.info('InferenceRouter', `[HERMES] DISPATCH: Task [${id.slice(0, 8)}] -> Nous Research Hermes Agent`);
    const res = await HermesBridge.runAgentTask(prompt, payload.options?.sessionKey ?? 'system');
    return res.reply;
  }
  if (engine === 'OPENCLAW' || targetUpper === 'OPENCLAW' || (payload.type === 'AGENTIC_TASK' && await OpenClawBridge.isReachable())) {
    const openClawKey = process.env.GOOGLE_API_KEY;
    const cost = 5;
    if (!GeminiQueueManager.hasCapacity(cost, openClawKey)) {
      Logger.warn('InferenceRouter', `[QUOTA] Agentic task [${id.slice(0, 8)}] postponed: OpenClaw Gemini quota near limit.`);
      throw new Error('GEMINI_DAILY_QUOTA_REACHED');
    }
    GeminiQueueManager.reserveCapacity(cost, openClawKey);
    const res = await OpenClawBridge.runAgentTask(prompt, payload.options?.sessionKey ?? 'system');
    return res.reply;
  }
  if (payload.type === 'EMBEDDING_GENERATION') {
    return JSON.stringify(await InferenceProviders.getEmbeddings(url!, prompt));
  }
  if (engine === 'MOBILE' || url === 'MOBILE_NODE') {
    return req.dispatchMobile();
  }
  if (url) {
    const thinking = payload.options?.thinking ? '\n\n(Think deeply.)' : '\n\n(Direct response.)';
    return InferenceProviders.callOllama(url, prompt + thinking, model, signal);
  }
  await req.wakeup();
  throw new Error(`NODE_${target}_OFFLINE`);
}

/** Daily call counter of a cloud provider (admin status); Gemini also feeds its rolling quota window. */
export function trackUsage(provider: 'gemini' | 'openrouter', apiKey?: string): void {
  try {
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
