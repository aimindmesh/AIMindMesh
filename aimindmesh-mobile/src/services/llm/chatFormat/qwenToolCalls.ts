/**
 * Qwen 3 / 3.5 native tool calls: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 * (JSON, one call per block; a block cut off by the token limit is dropped).
 */
import type { NativeToolCall } from './gemma4ToolCalls';

const BLOCK = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g;

export function parseQwenToolCalls(text: string): { calls: NativeToolCall[]; text: string } {
    const calls: NativeToolCall[] = [];
    let rest = text;
    for (const m of text.matchAll(BLOCK)) {
        try {
            const json = JSON.parse(m[1].replace(/,\s*([}\]])/g, '$1')) as { name?: string; arguments?: unknown };
            if (typeof json.name !== 'string') continue;
            const args = typeof json.arguments === 'string' ? JSON.parse(json.arguments) : json.arguments;
            calls.push({ name: json.name, args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> });
            rest = rest.replace(m[0], '');
        } catch {
            // Malformed or truncated JSON: not a call
        }
    }
    return { calls, text: rest.trim() };
}
