import { describe, expect, it } from 'vitest';
import golden from './fixtures/gemma4-template-golden.json';
import { formatGemma4Prompt } from '../src/services/llm/chatFormat/gemma4Format';
import type { GenieChatMessage } from 'genie-capacitor';

/** OpenAI request → the plugin's messages */
function messagesOf(request: any): GenieChatMessage[] {
    return request.messages.map((m: any) => m.tool_calls
        ? { role: 'assistant', content: m.content, toolCalls: m.tool_calls.map((c: any) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) }
        : m.role === 'tool' ? { role: 'tool', content: m.content, toolCallId: m.tool_call_id, toolName: m.name } : { role: m.role, content: m.content });
}

describe('Gemma 4 prompts without a chat template', () => {
    it.each(Object.entries(golden as Record<string, { request: any; prompt: string }>))('%s matches llama.cpp', (_name, { request, prompt }) => {
        const out = formatGemma4Prompt(messagesOf(request), { tools: request.tools, enableThinking: request.chat_template_kwargs?.enable_thinking, bos: false });
        expect(out).toBe(prompt);
    });

    it('starts with <bos> unless told not to', () => {
        expect(formatGemma4Prompt([{ role: 'user', content: 'x' }])).toBe('<bos><|turn>user\nx<turn|>\n<|turn>model\n');
    });
});
