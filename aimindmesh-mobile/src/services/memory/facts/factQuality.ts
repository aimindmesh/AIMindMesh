/**
 * What may enter the facts store. On-device models (inline <save_memory> tags, consolidation)
 * also produced questions ("the user asked about cats"), notes to themselves ("I need to
 * remember this fact") and plans with relative dates that turn false a day later ("tomorrow").
 */

export type FactRejection = 'empty' | 'too-short' | 'too-long' | 'question' | 'meta' | 'about-assistant';

const MIN_LENGTH = 8;
const MAX_LENGTH = 240;

const QUESTION = /\?\s*$|^(the user|user|l'utente|utente)\s+(asked|ha chiesto|chiede|domanda|wants to know|vuole sapere)\b|\b(asked about|ha chiesto (?:un'informazione|informazioni|una curiosità|di))\b/i;
const META = /\b(remember this|need to remember|i need to|i should remember|this fact|placeholder|da ricordare|devo ricordare|questo fatto)\b|[*<>{}[\]]|^\s*(fact|fatto|memory|memoria)\s*:|^(the user|user|l'utente|utente)\s+(mentioned|mentions|talked about|spoke about|ha menzionato|menziona|ha citato|ha parlato (di|del|della|dei|delle))\b/i;
const ASSISTANT = /^(the assistant|l'assistente|assistant|atlas)\b/i;

/** Why a candidate fact is not worth storing, or null when it is */
export function rejectFact(content: string | undefined | null): FactRejection | null {
    const text = (content ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return 'empty';
    if (text.length < MIN_LENGTH) return 'too-short';
    if (text.length > MAX_LENGTH) return 'too-long';
    if (QUESTION.test(text)) return 'question';
    if (META.test(text)) return 'meta';
    if (ASSISTANT.test(text)) return 'about-assistant';
    return null;
}

/** "User", "the user", "utente" are not a subject: the subject is another person or thing */
export function cleanSubject(subject: string | undefined | null): string | undefined {
    const s = (subject ?? '').trim();
    if (!s || /^(the\s+)?user$|^(l')?utente$|^me$|^io$/i.test(s)) return undefined;
    return s.slice(0, 60);
}

const RELATIVE_DAY = /\b(oggi|domani|dopodomani|ieri|stasera|stamattina|stanotte|tomorrow|today|tonight|yesterday|this (morning|evening|weekend)|questo (weekend|fine settimana)|(la |il )?prossim[oa] (settimana|mese|weekend)|next (week|month|weekend)|(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const RECURRING = /\b(ogni|tutti i|tutte le|di solito|every|each|usually|on (mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays))\b/i;

/** A date relative to when it was said ("tomorrow", "Saturday"), not a recurring one ("every Saturday") */
export function hasRelativeDate(content: string): boolean {
    return RELATIVE_DAY.test(content) && !RECURRING.test(content);
}

/**
 * Inline facts the chat model tagged that are worth saving now. Plans with relative dates are
 * left to the consolidation, which reads the same conversation and turns them into real dates.
 */
export function inlineFactsToSave(candidates: string[]): { save: string[]; skipped: Array<{ content: string; reason: string }> } {
    const save: string[] = [];
    const skipped: Array<{ content: string; reason: string }> = [];
    for (const candidate of candidates) {
        const content = candidate.replace(/\s+/g, ' ').trim();
        const rejection = rejectFact(content);
        if (rejection) skipped.push({ content, reason: rejection });
        else if (hasRelativeDate(content)) skipped.push({ content, reason: 'relative-date' });
        else save.push(content);
    }
    return { save, skipped };
}
