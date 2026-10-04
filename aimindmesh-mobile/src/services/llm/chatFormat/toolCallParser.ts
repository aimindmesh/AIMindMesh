/** Native tool calls of a model output, by chat-format family (ReAct <tool> text stays the fallback) */
import { parseReActToolCalls } from '../../tools';
import { parseGemma4ToolCalls, type NativeToolCall } from './gemma4ToolCalls';
import { parseQwenToolCalls } from './qwenToolCalls';
import type { ModelFamily } from './modelFamily';

export type { NativeToolCall };

export function parseToolCalls(text: string, family: ModelFamily): { calls: NativeToolCall[]; text: string } {
    const native = family === 'gemma4' ? parseGemma4ToolCalls(text) : family === 'qwen3' ? parseQwenToolCalls(text) : { calls: [], text };
    if (native.calls.length > 0) return native;
    // A model may still answer in the ReAct format it saw elsewhere
    const react = parseReActToolCalls(text);
    if (react.calls.length > 0) return { calls: react.calls.map(c => ({ name: c.name, args: (c.args ?? {}) as Record<string, unknown> })), text: react.cleanedText.trim() };
    return native;
}
