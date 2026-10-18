import type Anthropic from '@anthropic-ai/sdk';
import { Logger } from '../../../utils/Logger';
import { taskCategory } from '../providerIds';
import type { PromptParts } from '../promptParts';
import { claudeClient } from './claudeClient';
import { ClaudeCreditState } from './ClaudeCreditState';
import { ClaudeError, classifyClaudeError, isRejectedBeta } from './claudeErrors';
import type { ClaudeTicket } from './claudeGate';
import { priceUsage } from './claudePricing';
import { CLAUDE_CATEGORIES, claudeSettings, isClaudeModel, type ClaudeCategory, type ClaudeEffort } from './claudeSettings';
import { ClaudeUsage, type UsageMode, type UsageSource } from './ClaudeUsage';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORT_RANK: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Set when this organization rejected the server-side fallback beta: later calls go without it. */
let fallbackRejected = false;

/** Category whose model and effort a task type uses; null for types Claude does not serve. */
export function claudeCategory(type: string): ClaudeCategory | null {
  const category = taskCategory(type);
  return category && (CLAUDE_CATEGORIES as string[]).includes(category) ? category as ClaudeCategory : null;
}

/** Server-side fallback exists for the Opus and Sonnet families, not for Haiku. */
const supportsFallback = (model: string) => /^claude-(opus|sonnet|fable)-/.test(model);

export interface ClaudeRequestOptions {
  taskType: string;
  parts: PromptParts;
  /** `options.model` of the task: used only when it names a Claude model */
  model?: string;
  thinking?: boolean;
  /** A summary of the reasoning is requested (and streamed) only for callers that show it */
  showThinking?: boolean;
}

/** Messages API parameters of a router task (also the params of a batch request). */
export function buildClaudeParams(opts: ClaudeRequestOptions): CreateParams {
  const settings = claudeSettings();
  const category = claudeCategory(opts.taskType);
  if (!category) throw new ClaudeError('invalid', `task type ${opts.taskType} is not served by Claude`);
  const model = isClaudeModel(opts.model) ? opts.model : settings.models[category];
  let effort = settings.effort[category];
  if (opts.thinking && EFFORT_RANK.indexOf(effort) < EFFORT_RANK.indexOf('high')) effort = 'high';

  const content: Anthropic.Beta.Messages.BetaTextBlockParam[] = [];
  if (opts.parts.cachePrefix) content.push({ type: 'text', text: opts.parts.cachePrefix, cache_control: { type: 'ephemeral' } });
  content.push({ type: 'text', text: opts.parts.body });

  return {
    model,
    max_tokens: settings.maxTokens,
    messages: [{ role: 'user', content }],
    output_config: { effort },
    // Adaptive thinking is the default on these models: the parameter is sent only to ask for a summary
    ...(opts.showThinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
  };
}

/** Text of the answer (text blocks only), recording the usage. Throws on a refusal or a useless cut. */
export function finishClaudeMessage(message: BetaMessage, requestedModel: string, taskType: string, source: UsageSource, mode: UsageMode): string {
  ClaudeUsage.record(source, mode, priceUsage(requestedModel, message.model, message.usage as any, mode === 'batch'));
  if (message.stop_reason === 'refusal') {
    const category = (message as any).stop_details?.category ?? 'unknown';
    throw new ClaudeError('refusal', `declined (${category})`);
  }
  const text = message.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
  if (message.stop_reason === 'max_tokens') {
    if (claudeCategory(taskType) === 'EVOLUTION') throw new ClaudeError('truncated', 'answer cut at max_tokens');
    Logger.warn('ClaudeProvider', `Answer for ${taskType} cut at max_tokens (${message.usage.output_tokens} tokens)`);
  }
  return text;
}

/** Records an organization-wide refusal of the API (credit, key, model) for every caller. */
export function reportClaudeFailure(error: ClaudeError): void {
  if (error.kind === 'credit') ClaudeCreditState.reportBlocking('credit_exhausted', error.message);
  else if (error.kind === 'auth') ClaudeCreditState.reportBlocking('auth_error', error.message);
  else if (error.kind === 'unavailable') ClaudeCreditState.reportBlocking('unavailable', error.message);
}

export interface ClaudeCall extends ClaudeRequestOptions {
  ticket: ClaudeTicket;
  signal?: AbortSignal;
  onUpdate?: (update: { type: 'token' | 'thinking'; content: string }) => void;
}

async function stream(client: Anthropic, params: CreateParams, call: ClaudeCall, withFallback: boolean): Promise<BetaMessage> {
  const request = withFallback ? { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' as const } : params;
  const s = client.beta.messages.stream(request as any, { signal: call.signal });
  if (call.onUpdate) {
    s.on('text', delta => call.onUpdate!({ type: 'token', content: delta }));
    if (call.showThinking) s.on('thinking', delta => call.onUpdate!({ type: 'thinking', content: delta }));
  }
  return s.finalMessage();
}

/** One realtime call of the router: streams, records usage, updates the credit state. */
export async function callClaude(call: ClaudeCall): Promise<string> {
  try {
    const client = claudeClient();
    if (!client) throw new ClaudeError('auth', 'no API key configured');
    const params = buildClaudeParams(call);
    let withFallback = supportsFallback(params.model) && !fallbackRejected;
    let message: BetaMessage;
    try {
      message = await stream(client, params, call, withFallback);
    } catch (err) {
      if (!withFallback || !isRejectedBeta(err)) throw err;
      // The organization does not accept the fallback beta: retry once without it, and stop sending it
      fallbackRejected = true;
      withFallback = false;
      Logger.warn('ClaudeProvider', `Server-side fallback rejected (${(err as Error).message}): continuing without it`);
      message = await stream(client, params, call, false);
    }
    // The API answered: credit and key are fine, even if the model then declined
    ClaudeCreditState.reportSuccess();
    return finishClaudeMessage(message, params.model, call.taskType, call.ticket.source, 'realtime');
  } catch (err) {
    const error = classifyClaudeError(err);
    reportClaudeFailure(error);
    throw error;
  } finally {
    call.ticket.release();
  }
}

/** Test helper. */
export function resetClaudeProvider(): void {
  fallbackRejected = false;
}
