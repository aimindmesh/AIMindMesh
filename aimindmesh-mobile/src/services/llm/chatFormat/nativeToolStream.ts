/**
 * Streaming with native tool calls: the text before a call is shown as it comes, the call itself
 * (`<|tool_call>call:…` for Gemma 4, `<tool_call>{…}` for Qwen) never reaches the chat bubble —
 * it is parsed when the generation ends. A possible partial marker at the end is held back.
 */
import type { ModelFamily } from './modelFamily';

const MARKERS: Record<ModelFamily, RegExp> = {
    gemma4: /<\|tool_call>|(?:^|\n)\s*call:[A-Za-z_][\w.-]*\s*\{/,
    qwen3: /<tool_call>/,
    generic: /<tool>/,
};
/** Longest marker prefix that may still be arriving */
const HOLD = 14;

/** The part of the output that may be shown: up to the first call, minus a possible partial marker */
export function visibleText(full: string, family: ModelFamily, done = false): string {
    const m = MARKERS[family].exec(full);
    if (m) return full.slice(0, m.index);
    if (done) return full;
    const lastOpen = full.lastIndexOf('<', full.length - 1);
    const lastLine = full.lastIndexOf('\n');
    // Hold back a tail that could become a marker: "<|tool_" or a line starting with "call:"
    const holdFrom = Math.max(lastOpen >= full.length - HOLD ? lastOpen : -1, family === 'gemma4' && /^\s*c(a(l(l(:\w*)?)?)?)?$/.test(full.slice(lastLine + 1)) ? lastLine + 1 : -1);
    return holdFrom >= 0 ? full.slice(0, holdFrom) : full;
}

/** Stop strings after a call: the engine must not write the tool's answer itself */
export function toolStopSequences(family: ModelFamily): string[] {
    return family === 'gemma4' ? ['<|tool_response>'] : family === 'qwen3' ? ['<tool_response>'] : [];
}

/** The reasoning channel is not part of the answer: a call mentioned there is not a call */
export const withoutThought = (text: string) => text.replace(/<\|channel\|?>thought[\s\S]*?(?:<channel\|>|$)/g, '');
