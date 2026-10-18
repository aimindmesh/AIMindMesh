import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PassThrough } from 'stream';
import { Logger } from '../../../../utils/Logger';
import { claudeClient } from '../claudeClient';
import { ClaudeCreditState } from '../ClaudeCreditState';
import { classifyClaudeError, isRejectedBeta } from '../claudeErrors';
import { priceUsage } from '../claudePricing';
import { reportClaudeFailure } from '../ClaudeProvider';
import { claudeSettings } from '../claudeSettings';
import { ClaudeUsage } from '../ClaudeUsage';
import type { ClaudeAgentRoute } from './agentClaudeGate';
import { toOpenAiCompletion } from './anthropicToOpenai';
import { toAnthropicRequest, TranslationError } from './openaiToAnthropic';
import { OpenAiChunkWriter } from './streamToOpenai';
import { rememberThinking } from './thinkingStore';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Set when the organization rejected the betas: later agent calls go without them. */
let betasRejected = false;

/**
 * Betas of an agent call: replayed thinking blocks that no longer match (an agent that trimmed
 * its history) are dropped instead of failing the request, and Opus/Sonnet refusals fall back
 * server-side to the model Anthropic recommends.
 */
function withBetas(params: Params): Params {
  if (betasRejected) return params;
  const fallback = /^claude-(opus|sonnet|fable)-/.test(params.model);
  return {
    ...params,
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    ...(fallback ? { fallbacks: 'default' } : {}),
    betas: [THINKING_BINDING_BETA, ...(fallback ? [FALLBACK_BETA] : [])],
  } as Params;
}

/** Records what the call cost and keeps its thinking blocks for the next turn of the tool loop. */
function afterMessage(message: BetaMessage, route: ClaudeAgentRoute): void {
  ClaudeUsage.record(route.source, 'realtime', priceUsage(route.model, message.model, message.usage as any));
  ClaudeCreditState.reportSuccess();
  rememberThinking(message.content as any);
}

/** Opens the stream and reads its first event, retrying once without betas the organization rejects. */
async function openStream(client: Anthropic, params: Params, signal: AbortSignal) {
  const open = (p: Params) => {
    const stream = client.beta.messages.stream(p as any, { signal });
    const iterator = stream[Symbol.asyncIterator]();
    return { stream, iterator };
  };
  let s = open(withBetas(params));
  try {
    return { ...s, first: await s.iterator.next() };
  } catch (err) {
    if (betasRejected || !isRejectedBeta(err)) throw err;
    betasRejected = true;
    Logger.warn('AgentBridge', `Betas rejected (${(err as Error).message}): agent calls continue without them`);
    s = open(params);
    return { ...s, first: await s.iterator.next() };
  }
}

/**
 * Answers an agent's OpenAI chat completion with Claude. Returns false when nothing was sent
 * (untranslatable request, Claude error or refusal before the first byte): the caller then
 * forwards the same request to FreeLLMAPI. Once a stream has started, an error is reported in
 * the stream itself.
 */
export async function serveWithClaude(request: FastifyRequest, reply: FastifyReply, body: any, route: ClaudeAgentRoute): Promise<boolean> {
  let handedOff = false;
  const abort = new AbortController();
  const onClose = () => { if (!reply.raw.writableEnded) abort.abort(); };
  reply.raw.on('close', onClose);
  try {
    const client = claudeClient();
    if (!client) return false;
    const params = toAnthropicRequest(body, { model: route.model, effort: route.effort, defaultMaxTokens: claudeSettings().maxTokens });
    Logger.info('AgentBridge', `${route.source} request from ${request.ip} -> Claude ${route.model} (messages: ${params.messages.length}, tools: ${params.tools?.length ?? 0}, stream: ${!!body.stream})`);

    const { stream, iterator, first } = await openStream(client, params, abort.signal);

    if (!body.stream) {
      for (let next = first; !next.done; next = await iterator.next()) { /* drain: finalMessage collects it */ }
      const message = await stream.finalMessage() as BetaMessage;
      afterMessage(message, route);
      if (message.stop_reason === 'refusal') {
        Logger.warn('AgentBridge', `Claude declined the ${route.source} request: falling back to FreeLLMAPI`);
        return false;
      }
      reply.code(200).send(toOpenAiCompletion(message, route.model));
      return true;
    }

    // Streaming: committed from the first event on
    const writer = new OpenAiChunkWriter(route.model, body.stream_options?.include_usage === true);
    const out = new PassThrough();
    reply.headers({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    reply.send(out);
    handedOff = true;
    void (async () => {
      try {
        for (let next = first; !next.done; next = await iterator.next()) {
          const text = writer.write(next.value as any);
          if (text) out.write(text);
        }
        afterMessage(await stream.finalMessage() as BetaMessage, route);
        out.end(writer.end());
      } catch (err) {
        const error = classifyClaudeError(err);
        reportClaudeFailure(error);
        Logger.warn('AgentBridge', `Claude stream failed after it started (${error.kind}): ${error.message}`);
        out.end(writer.error(error.message));
      } finally {
        route.ticket.release();
        reply.raw.off('close', onClose);
      }
    })();
    return true;
  } catch (err) {
    if (err instanceof TranslationError) {
      Logger.info('AgentBridge', `Request not translatable for Claude (${err.message}): FreeLLMAPI`);
      return false;
    }
    const error = classifyClaudeError(err);
    reportClaudeFailure(error);
    if (error.kind === 'aborted') return true; // the agent went away: nothing to send anywhere
    Logger.warn('AgentBridge', `Claude failed for the ${route.source} request (${error.kind}): falling back to FreeLLMAPI. ${error.message}`);
    return false;
  } finally {
    if (!handedOff) {
      route.ticket.release();
      reply.raw.off('close', onClose);
    }
  }
}

/** Test helper. */
export function resetAgentBridge(): void {
  betasRejected = false;
}
