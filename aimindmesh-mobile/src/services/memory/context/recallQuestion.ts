/**
 * Questions about what the assistant knows of the user ("ricordi dove abito?", "come si chiama
 * mia sorella?", "what do you know about me?"). Small on-device models answer "I have no memory"
 * even with the facts in the prompt, and pick the web search over search_memory: for these the
 * app retrieves more and tells the model, next to the question, how to answer.
 */
import type { Fact } from '../facts/factTypes';

const RECALL_PATTERNS: RegExp[] = [
    // Italian
    /\b(ti\s+)?ricord[ia]\b/i,
    /\bti\s+(ho|avevo)\s+(detto|parlato|raccontato|scritto)\b/i,
    /\b(sai|conosci)\s+(dove|come|chi|quando|qual[ei]?|quant[ioe]|cosa|il mio|la mia|i miei|le mie)\b/i,
    /\bcosa\s+(sai|ricordi)\s+(di|su)\s+me\b/i,
    /\bdove\s+(abito|vivo|lavoro|sono\s+nat[oa])\b/i,
    /\bcome\s+(mi\s+chiamo|si\s+chiama(no)?\s+(il|la|i|le|mio|mia|miei|mie))\b/i,
    /\b(qual\s+è|quando\s+è|chi\s+è)\s+(il|la)\s+mi[oa]\b/i,
    // English
    /\b(do|did)\s+you\s+(remember|recall)\b/i,
    /\bdid\s+i\s+(tell|mention|say)\b/i,
    /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
    /\bwhere\s+do\s+i\s+(live|work)\b/i,
    /\bwhat(?:'s|\s+is)\s+my\b/i,
    /\b(who|when)\s+is\s+my\b/i,
];

export function isRecallQuestion(text: string): boolean {
    const t = text.trim();
    return t.length > 0 && t.length < 400 && RECALL_PATTERNS.some(p => p.test(t));
}

export const RECALL_INSTRUCTION = `THE USER IS ASKING WHAT YOU REMEMBER ABOUT THEM.
- Answer from WHAT YOU KNOW ABOUT THE USER (above) and the facts and memories in this context.
- If the answer is there, give it naturally. If it is not, say plainly that they have not told you yet; if you know something related, mention it and ask (e.g. you know they run in a town: ask whether they live there).
- Never say you have no memory, and never search the web for the user's personal facts.
- Answer briefly, in the language the user wrote in.`;

/**
 * Facts for a recall question: the related ones first, then the most important of the others,
 * so a question with no keyword in common ("where do I live?") still sees what is known.
 */
export function recallFacts(related: Fact[], all: Fact[], exclude: Set<string>, limit: number): Fact[] {
    const picked = new Map(related.map(f => [f.id, f]));
    const rest = all
        .filter(f => f.status === 'active' && !exclude.has(f.id) && !picked.has(f.id))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance || b.updatedAt - a.updatedAt);
    for (const fact of rest) {
        if (picked.size >= limit) break;
        picked.set(fact.id, fact);
    }
    return [...picked.values()].slice(0, limit);
}

const WEB_TOOLS = new Set(['search_web', 'read_web_page', 'search_web_page']);

/**
 * A recall question answered with a web search (seen on the Fold7 even with the rules in the
 * prompt): the search runs on the user's memory instead, with their question.
 */
export function redirectRecallToolCall<T extends { name: string; args?: Record<string, unknown> }>(call: T, userText: string): T {
    if (!WEB_TOOLS.has(call.name) || !isRecallQuestion(userText)) return call;
    return { ...call, name: 'search_memory', args: { query: userText.trim() } };
}
