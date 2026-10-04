/**
 * Gemma 4 prompts written as its chat template writes them (checked against llama.cpp's
 * /apply-template in test/fixtures/gemma4-template-golden.json), for engines with no template:
 * QAIRT bundles whose tokenizer has none. Tools are declared in the system turn, calls and
 * results stay in the model turn, which goes on after the results:
 *   <|turn>system\n[<|think|>\n]S<|tool>declaration:name{…}<tool|><turn|>\n
 *   <|turn>model\n<|tool_call>call:name{…}<tool_call|><|tool_response>response:name{value:…}<tool_response|>
 */
import type { GenieChatMessage } from 'genie-capacitor';
import type { ToolDeclaration } from '../../tools/nativeToolDeclarations';
import { formatGemma4ToolCall } from './gemma4ToolCalls';

const Q = '<|"|>';

/** A value in the template's notation: bare sorted keys, <|"|> strings, uppercase schema types */
function value(v: unknown, key?: string): string {
    if (typeof v === 'string') return `${Q}${key === 'type' ? v.toUpperCase() : v}${Q}`;
    if (Array.isArray(v)) return `[${v.map(x => value(x)).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).sort().map(k => `${k}:${value(o[k], k)}`).join(',')}}`;
    }
    return String(v);
}

export function formatGemma4Declaration(tool: ToolDeclaration): string {
    const { name, ...rest } = tool.function;
    return `<|tool>declaration:${name}${value(rest)}<tool|>`;
}

const parseArgs = (json: string): Record<string, unknown> => {
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

export function formatGemma4Prompt(
    messages: GenieChatMessage[],
    options: { tools?: ToolDeclaration[]; enableThinking?: boolean; bos?: boolean } = {},
): string {
    let out = options.bos === false ? '' : '<bos>';
    const system = messages[0]?.role === 'system' ? messages[0] : undefined;
    const tools = options.tools ?? [];
    if (system || tools.length > 0 || options.enableThinking) {
        out += `<|turn>system\n${options.enableThinking ? '<|think|>\n' : ''}${system?.content ?? ''}${tools.map(formatGemma4Declaration).join('')}<turn|>\n`;
    }
    let inModelTurn = false; // after tool calls the model turn stays open
    for (const m of messages.slice(system ? 1 : 0)) {
        if (m.role === 'tool') {
            out += `<|tool_response>response:${m.toolName ?? 'tool'}{value:${Q}${m.content}${Q}}<tool_response|>`;
            continue;
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
            out += `${inModelTurn ? '' : '<|turn>model\n'}${m.content}${m.toolCalls.map(c => formatGemma4ToolCall({ name: c.name, args: parseArgs(c.arguments) })).join('')}`;
            inModelTurn = true;
            continue;
        }
        inModelTurn = false;
        out += `<|turn>${m.role === 'assistant' ? 'model' : 'user'}\n${m.content}<turn|>\n`;
    }
    const last = messages[messages.length - 1];
    return last && (last.role === 'tool' || (last.role === 'assistant' && last.toolCalls?.length)) ? out : `${out}<|turn>model\n`;
}
