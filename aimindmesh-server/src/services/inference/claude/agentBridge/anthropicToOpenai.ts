import type Anthropic from '@anthropic-ai/sdk';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** OpenAI finish_reason of a Claude stop_reason. */
export function finishReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case 'tool_use': return 'tool_calls';
    case 'max_tokens': return 'length';
    case 'refusal': return 'content_filter';
    default: return 'stop';
  }
}

/** OpenAI usage of a Claude usage (prompt tokens include the cached ones, as OpenAI counts them). */
export function openAiUsage(usage: Partial<BetaMessage['usage']> | undefined) {
  const cached = usage?.cache_read_input_tokens ?? 0;
  const prompt = (usage?.input_tokens ?? 0) + cached + (usage?.cache_creation_input_tokens ?? 0);
  const completion = usage?.output_tokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached },
  };
}

/** A complete (non-streamed) chat completion from a Claude message: text, tool calls, usage. */
export function toOpenAiCompletion(message: BetaMessage, model: string) {
  const text = message.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('');
  const toolCalls = message.content
    .filter(b => b.type === 'tool_use')
    .map(b => {
      const call = b as { id: string; name: string; input: unknown };
      return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) } };
    });
  return {
    id: message.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: finishReason(message.stop_reason),
    }],
    usage: openAiUsage(message.usage),
  };
}
