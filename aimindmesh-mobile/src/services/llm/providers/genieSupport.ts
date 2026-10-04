/**
 * Pure helpers of the Genie (Qualcomm GenieX) provider. Two kinds of models:
 * - GGUF files on the llama_cpp runtime: the same file on the NPU of the Fold5 (v73) and the
 *   Fold7 (v79), prompts from the chat template embedded in the GGUF;
 * - QAIRT bundles from Qualcomm AI Hub (8 Elite only), prompts formatted here.
 */
import type { Message, LLMConfig } from '../../../types';
import type { GenieChatMessage, GenieLoadedModel, GenieRuntime } from 'genie-capacitor';
import { toChatRole } from '../roles';
import { genieContextSize } from '../context/contextSize';

export const isGgufPath = (path: string | undefined | null): boolean => !!path && path.trim().toLowerCase().endsWith('.gguf');

/** Context of the Genie engine: auto per phone or set by hand for GGUF, the bundle's for QAIRT */
export const genieContextLength = (config: LLMConfig | undefined, modelPath: string): number => genieContextSize(config, isGgufPath(modelPath));

export const genieRuntime = (config?: LLMConfig): GenieRuntime => config?.genieRuntime ?? 'auto';

/** Whether the loaded GGUF already runs as configured: otherwise it is loaded again (unit or context changed) */
export function genieLoadMatches(loaded: GenieLoadedModel, runtime: GenieRuntime, contextLength: number): boolean {
    if (loaded.runtime !== 'llama_cpp') return true;
    const unitOk = runtime === 'auto' || loaded.computeUnit === runtime;
    return unitOk && (!loaded.contextLength || loaded.contextLength === contextLength);
}

export type TemplateMessage = GenieChatMessage;

/**
 * Messages for the model's chat template: the system prompt, then the conversation with the
 * roles alternating (Gemma templates reject two user turns in a row: consecutive ones are merged).
 * With `nativeTools`, the agent's tool turns become assistant tool calls and `tool` messages, as
 * the model was trained to read them; otherwise their text (ReAct) is used.
 */
export function toTemplateMessages(systemPrompt: string, history: Message[], lastUserImages = 0, nativeTools = false): TemplateMessage[] {
    const out: TemplateMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const msg of history) {
        const meta = nativeTools ? msg.toolMeta : undefined;
        if (meta?.calls?.length && msg.role === 'model') {
            out.push({ role: 'assistant', content: '', toolCalls: meta.calls.map(c => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.args) })) });
            continue;
        }
        if (meta?.results?.length) {
            for (const r of meta.results) {
                out.push({ role: 'tool', content: r.success ? r.result : `Error: ${r.result}`, toolCallId: r.id, toolName: r.name });
            }
            continue;
        }
        const role = toChatRole(msg.role);
        const text = msg.text || '';
        const last = out[out.length - 1];
        if (last.role === role && !last.toolCalls) last.content += `\n\n${text}`;
        else out.push({ role, content: text });
    }
    // The images of the request being answered go into the last user turn
    const lastUser = [...out].reverse().find(m => m.role === 'user');
    if (lastUser && lastUserImages > 0) lastUser.imageCount = lastUserImages;
    return out;
}

/** The message being answered: images are sent for it only (older ones would be re-encoded every turn) */
export function lastUserMessage(history: Message[]): Message | undefined {
    for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') return history[i];
    return undefined;
}

/** Prompt for a QAIRT bundle (no template in the bundle): ChatML for Qwen, Gemma 4 or Gemma 2/3 turns, a transcript otherwise */
export function formatBundlePrompt(
    modelPath: string, systemPrompt: string, history: Message[], assistantName: string
): { prompt: string; stopSequences?: string[] } {
    const name = modelPath.toLowerCase();
    if (name.includes('qwen')) {
        let prompt = `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
        for (const msg of history) prompt += `<|im_start|>${toChatRole(msg.role)}\n${msg.text}<|im_end|>\n`;
        return { prompt: prompt + '<|im_start|>assistant\n', stopSequences: ['<|im_end|>', '<|endoftext|>'] };
    }
    if (/gemma[-_]?4/.test(name)) {
        // Gemma 4 turns (the bundle's sample_prompt.txt)
        let prompt = `<bos><|turn>system\n${systemPrompt}<turn|>\n`;
        for (const msg of history) prompt += `<|turn>${msg.role === 'model' ? 'model' : 'user'}\n${msg.text}<turn|>\n`;
        return { prompt: prompt + '<|turn>model\n', stopSequences: ['<turn|>'] };
    }
    if (name.includes('gemma')) {
        let prompt = `<start_of_turn>system\n${systemPrompt}<end_of_turn>\n`;
        for (const msg of history) prompt += `<start_of_turn>${msg.role === 'model' ? 'model' : 'user'}\n${msg.text}<end_of_turn>\n`;
        return { prompt: prompt + '<start_of_turn>model\n', stopSequences: ['<end_of_turn>'] };
    }
    let prompt = `System: ${systemPrompt}\n\n`;
    for (const msg of history) prompt += `${msg.role === 'model' ? assistantName : 'User'}: ${msg.text}\n\n`;
    return { prompt: prompt + `${assistantName}: ` };
}
