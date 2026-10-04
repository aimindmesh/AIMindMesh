/**
 * Template messages (genieSupport.toTemplateMessages) in the OpenAI form that llama.cpp's
 * common_chat and llama-server take: assistant `tool_calls` and `tool` results.
 */
import type { GenieChatMessage } from 'genie-capacitor';

export interface OpenAIChatMessage {
    role: string;
    content: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
    name?: string;
}

export function toOpenAIMessages(messages: GenieChatMessage[]): OpenAIChatMessage[] {
    return messages.map(m => {
        if (m.toolCalls?.length) {
            return { role: 'assistant', content: m.content, tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) };
        }
        if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.toolCallId, name: m.toolName };
        return { role: m.role, content: m.content };
    });
}
