import type Anthropic from '@anthropic-ai/sdk';
import { finishReason, openAiUsage } from './anthropicToOpenai';

type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;

/**
 * Turns Claude stream events into OpenAI `chat.completion.chunk` SSE lines: text deltas become
 * `delta.content`, a tool_use block opens `delta.tool_calls[i]` (id and name) and its JSON
 * deltas extend the arguments. Thinking is not forwarded (the OpenAI format has no place for it).
 */
export class OpenAiChunkWriter {
  private readonly id: string;
  private readonly created = Math.floor(Date.now() / 1000);
  private toolIndexByBlock = new Map<number, number>();
  private nextToolIndex = 0;
  private usage: Record<string, number> = {};
  private stopReason: string | null = null;

  constructor(private readonly model: string, private readonly includeUsage: boolean, id?: string) {
    this.id = id ?? `chatcmpl-${Date.now().toString(36)}`;
  }

  private chunk(delta: Record<string, unknown>, finish: string | null = null): string {
    return `data: ${JSON.stringify({
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  }

  /** SSE text for one Claude event ('' when it has no OpenAI counterpart). */
  public write(event: StreamEvent): string {
    switch (event.type) {
      case 'message_start':
        this.usage = { ...(event.message.usage as any) };
        return this.chunk({ role: 'assistant', content: '' });
      case 'content_block_start': {
        const block = event.content_block as { type: string; id?: string; name?: string };
        if (block.type !== 'tool_use') return '';
        const index = this.nextToolIndex++;
        this.toolIndexByBlock.set(event.index, index);
        return this.chunk({ tool_calls: [{ index, id: block.id, type: 'function', function: { name: block.name, arguments: '' } }] });
      }
      case 'content_block_delta': {
        const delta = event.delta as { type: string; text?: string; partial_json?: string };
        if (delta.type === 'text_delta' && delta.text) return this.chunk({ content: delta.text });
        if (delta.type === 'input_json_delta' && delta.partial_json) {
          const index = this.toolIndexByBlock.get(event.index);
          return index === undefined ? '' : this.chunk({ tool_calls: [{ index, function: { arguments: delta.partial_json } }] });
        }
        return '';
      }
      case 'message_delta':
        this.stopReason = event.delta.stop_reason ?? this.stopReason;
        this.usage = { ...this.usage, ...Object.fromEntries(Object.entries(event.usage ?? {}).filter(([, v]) => typeof v === 'number')) };
        return '';
      default:
        return '';
    }
  }

  /** Closing lines: the finish reason, the usage chunk when asked for, and [DONE]. */
  public end(): string {
    let out = this.chunk({}, finishReason(this.stopReason));
    if (this.includeUsage) {
      out += `data: ${JSON.stringify({ id: this.id, object: 'chat.completion.chunk', created: this.created, model: this.model, choices: [], usage: openAiUsage(this.usage as any) })}\n\n`;
    }
    return out + 'data: [DONE]\n\n';
  }

  /** An error after the stream started: OpenAI clients read it from an `error` event. */
  public error(message: string): string {
    return `data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\ndata: [DONE]\n\n`;
  }
}
