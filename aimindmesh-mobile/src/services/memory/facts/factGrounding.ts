/**
 * A fact must come from the user's own words. The extractor quotes them ("evidence"); the quote
 * must be found in a message the USER wrote (assistant lines are context, never a source) and
 * share meaning words with the fact. Stops invented facts ("the user asked about cats", facts
 * taken from the assistant's suggestions, the date header of the prompt).
 */
import { stems } from '../context/memoryContext';

const words = (text: string) => (text.toLowerCase().normalize('NFKC').match(/\p{L}[\p{L}\p{N}']*|\p{N}+/gu) || [])
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));

/** Share of the quote's words found in the message (order-insensitive) */
function coverage(quote: string[], message: Set<string>): number {
    if (quote.length === 0) return 0;
    return quote.filter(w => message.has(w)).length / quote.length;
}

export const MIN_COVERAGE = 0.8;

export function isGrounded(evidence: string | undefined | null, userTexts: string[], content: string): boolean {
    const quote = words(evidence ?? '');
    if (quote.length < 2) return false;
    const found = userTexts.some(text => coverage(quote, new Set(words(text))) >= MIN_COVERAGE);
    if (!found) return false;
    // The fact must be about what was quoted: at least one meaning word in common
    const factStems = stems(content);
    for (const s of stems(evidence ?? '')) if (factStems.has(s)) return true;
    return false;
}

/** Share of the fact's meaning words a message must contain to support a paraphrased fact */
const PARAPHRASE_SHARE = 0.5;

/**
 * Index of the user message a fact comes from, or -1: the quoted evidence, else a message that
 * contains most of the fact's meaning words (small models often paraphrase or omit the quote).
 * Facts taken from the assistant's lines or from the prompt find no message.
 */
export function groundingMessage(evidence: string | undefined | null, content: string, userTexts: string[]): number {
    const quote = words(evidence ?? '');
    const factStems = stems(content);
    if (quote.length >= 2) {
        const evidenceStems = stems(evidence ?? '');
        const related = [...evidenceStems].some(s => factStems.has(s));
        const i = userTexts.findIndex(text => coverage(quote, new Set(words(text))) >= MIN_COVERAGE);
        if (i >= 0 && related) return i;
    }
    if (factStems.size === 0) return -1;
    const needed = factStems.size >= 3 ? 2 : 1;
    return userTexts.findIndex(text => {
        const message = stems(text);
        let shared = 0;
        for (const s of factStems) if (message.has(s)) shared++;
        return shared >= needed && shared / factStems.size >= PARAPHRASE_SHARE;
    });
}
