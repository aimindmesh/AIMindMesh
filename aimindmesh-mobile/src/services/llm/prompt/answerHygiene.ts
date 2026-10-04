/**
 * Leftovers small models leave in the visible answer: template tokens, ReAct labels, invented
 * tool blocks, "In Italian:" translations of their own English draft.
 */

const BLOCKS = [
    /<tool_code>[\s\S]*?(<\/tool_code>|$)/gi,        // a tool call in a format nobody asked for
    /<observation>[\s\S]*?(<\/observation>|$)/gi,    // an invented tool result
    /<\|?channel\|?>thought[\s\S]*?(<channel\|>|$)/gi, // Gemma 4 thinking that leaked into the text
];
const TOKENS = /<\|?(turn|tool_call|tool_response|tool|channel|think|im_start|im_end|endoftext)\|?>|<(turn|tool_call|tool_response|tool|channel)\|>|<\/?start_of_turn>|<end_of_turn>/gi;

export function cleanAnswerText(text: string): string {
    let out = text;
    for (const block of BLOCKS) out = out.replace(block, '');
    out = out.replace(TOKENS, '');
    // "Answer: …" (ReAct) and a model answering twice, the second time "In Italian:"
    out = out.replace(/^\s*(Answer|Risposta|Final answer)\s*:\s*/i, '');
    const translated = /\n\s*(In Italian|In italiano|Translation)\s*:\s*\n?([\s\S]+)$/i.exec(out);
    if (translated && translated[2].trim().length > 10) out = translated[2];
    // A stray "*" closing a sentence ("…this fact.*")
    out = out.replace(/([.!?])\*(?=\s|$)/g, '$1');
    return out.replace(/\n{3,}/g, '\n\n').trim();
}
