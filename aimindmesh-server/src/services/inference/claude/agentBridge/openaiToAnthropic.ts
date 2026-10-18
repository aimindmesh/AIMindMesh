import type Anthropic from '@anthropic-ai/sdk';
import { Logger } from '../../../../utils/Logger';
import { recallThinking } from './thinkingStore';
import type { ClaudeEffort } from '../claudeSettings';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** A request the bridge cannot express for Claude: it goes to FreeLLMAPI unchanged. */
export class TranslationError extends Error {}

const MIN_MAX_TOKENS = 4_096;
const MAX_MAX_TOKENS = 64_000;

/** Text of an OpenAI content value (string or parts). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(p => (p && p.type === 'text' && typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
  return '';
}

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s;

function userBlocks(content: unknown): Block[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      blocks.push({ type: 'text', text: part.text });
    } else if (part?.type === 'image_url') {
      const url: string = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (!url) continue;
      const data = DATA_URL.exec(url);
      blocks.push(data
        ? { type: 'image', source: { type: 'base64', media_type: data[1] as any, data: data[2] } }
        : { type: 'image', source: { type: 'url', url } });
    }
    // Audio and file parts have no Claude equivalent here: dropped
  }
  return blocks;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    throw new TranslationError('tool call arguments are not valid JSON');
  }
}

function assistantBlocks(msg: any): Block[] {
  const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const blocks: Block[] = [];
  // Thinking first, exactly as Claude produced it before these tool calls
  if (calls.length > 0) blocks.push(...(recallThinking(calls.map(c => c.id).filter(Boolean)) as Block[]));
  const text = textOf(msg.content);
  if (text.trim()) blocks.push({ type: 'text', text });
  for (const call of calls) {
    if (!call?.id || !call.function?.name) throw new TranslationError('tool call without id or name');
    blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) });
  }
  return blocks;
}

function toolResultBlock(msg: any): Block {
  if (!msg.tool_call_id) throw new TranslationError('tool message without tool_call_id');
  const text = textOf(msg.content);
  return { type: 'tool_result', tool_use_id: msg.tool_call_id, content: text || '(empty)' };
}

/** Messages in Claude's shape: system apart, tool results in user turns, same roles merged. */
function convertMessages(messages: any[]): { system: string; messages: MessageParam[] } {
  const systemParts: string[] = [];
  const out: MessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      const lastBlocks = last.content as Block[];
      // Tool results must open the user turn that follows the tool calls
      if (role === 'user' && blocks.some(b => b.type === 'tool_result')) {
        const results = blocks.filter(b => b.type === 'tool_result');
        const rest = blocks.filter(b => b.type !== 'tool_result');
        last.content = [...lastBlocks.filter(b => b.type === 'tool_result'), ...results, ...lastBlocks.filter(b => b.type !== 'tool_result'), ...rest];
      } else {
        last.content = [...lastBlocks, ...blocks];
      }
    } else {
      out.push({ role, content: blocks });
    }
  };

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    switch (msg.role) {
      case 'system':
      case 'developer': {
        const text = textOf(msg.content);
        if (text.trim()) systemParts.push(text);
        break;
      }
      case 'user':
        push('user', userBlocks(msg.content));
        break;
      case 'assistant':
        push('assistant', assistantBlocks(msg));
        break;
      case 'tool':
        push('user', [toolResultBlock(msg)]);
        break;
      default:
        throw new TranslationError(`unsupported message role ${String(msg.role)}`);
    }
  }
  if (out.length === 0) throw new TranslationError('no messages');
  if (out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue.' }] });
  if (out[out.length - 1].role !== 'user') throw new TranslationError('the last message is not a user or tool message');
  return { system: systemParts.join('\n\n'), messages: out };
}

function convertTools(body: any): Pick<Params, 'tools' | 'tool_choice'> {
  const tools = (Array.isArray(body.tools) ? body.tools : [])
    .filter((t: any) => t?.type === 'function' && t.function?.name)
    .map((t: any) => {
      const schema = t.function.parameters && typeof t.function.parameters === 'object' ? { ...t.function.parameters } : {};
      if (schema.type !== 'object') schema.type = 'object';
      return { name: t.function.name, description: t.function.description || undefined, input_schema: schema };
    });
  if (tools.length === 0) return {};

  const choice = body.tool_choice;
  const disableParallel = body.parallel_tool_calls === false ? { disable_parallel_tool_use: true } : {};
  if (choice === 'none') return { tools, tool_choice: { type: 'none' } };
  if (choice === 'required' || (choice && typeof choice === 'object')) {
    // Forced tool use returns a 400 on the current Opus and Sonnet: the model decides
    Logger.debug('AgentBridge', `tool_choice ${JSON.stringify(choice)} sent as auto`);
  }
  return { tools, tool_choice: { type: 'auto', ...disableParallel } };
}

export interface BridgeRequestOptions {
  model: string;
  effort: ClaudeEffort;
  defaultMaxTokens: number;
}

/**
 * The Claude Messages request of an OpenAI chat completion. Sampling parameters (temperature,
 * top_p, seed, penalties) are dropped: the current models reject or ignore them. The system
 * prompt carries a cache breakpoint and the request asks for automatic caching of the growing
 * conversation: an agent re-sends its whole history on every turn.
 */
export function toAnthropicRequest(body: any, opts: BridgeRequestOptions): Params {
  if (!body || !Array.isArray(body.messages)) throw new TranslationError('messages is required');
  if (body.n !== undefined && body.n !== 1) throw new TranslationError('n > 1 is not supported');
  const { system, messages } = convertMessages(body.messages);

  const requested = Number(body.max_completion_tokens ?? body.max_tokens);
  const maxTokens = Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Number.isFinite(requested) && requested > 0 ? requested : opts.defaultMaxTokens));
  const stops = (Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : []).filter((s: unknown) => typeof s === 'string' && s.trim());

  const params: Params = {
    model: opts.model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
    ...convertTools(body),
    ...(stops.length ? { stop_sequences: stops } : {}),
    cache_control: { type: 'ephemeral' },
    output_config: { effort: opts.effort },
  };

  const format = body.response_format;
  if (format?.type === 'json_schema' && format.json_schema?.schema) {
    params.output_config = { ...params.output_config, format: { type: 'json_schema', schema: format.json_schema.schema } };
  }
  return params;
}
