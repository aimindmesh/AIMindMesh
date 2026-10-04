/**
 * What the model is told about the user on every turn:
 * - the PROFILE: pinned facts, then the most important ones, and the dates coming up. It is
 *   deterministic (never ordered by use), so the system prompt stays the same between turns
 *   and the on-device KV cache stays valid until a fact changes;
 * - the RELEVANT facts for the current request (the ones the profile had no room for).
 */
import { Fact, KIND_LABELS, isOpenLoop } from '../facts/factTypes';
import { cosineSimilarity } from '../embeddingCodec';
import { PROMPT_TEXTS } from '../../llm/prompt/promptTexts';
import type { ResolvedLanguage } from '../../llm/prompt/languageRule';

/** On-device prompts: headers in the assistant's language, plain lines (no "(about you)" labels) */
export interface ProfileStyle { lang: ResolvedLanguage }

/** Profile size in characters: small context windows get a short profile */
export function profileBudget(contextWindow: number): number {
    if (contextWindow <= 4096) return 900;
    if (contextWindow <= 16384) return 1800;
    return 3000;
}

const UPCOMING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const KIND_ORDER = ['identity', 'person', 'preference', 'goal', 'project', 'routine', 'commitment', 'event', 'other'];

const isoDay = (time: number) => {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function formatFactLine(fact: Fact, style?: ProfileStyle): string {
    const subject = fact.subject && !fact.content.toLowerCase().includes(fact.subject.toLowerCase()) ? `${fact.subject}: ` : '';
    if (style) return `- ${subject}${fact.content}`;
    const label = KIND_LABELS[fact.kind].toLowerCase();
    return `- (${label}) ${subject}${fact.content}`;
}

/** Profile order: pinned, importance, kind, age (stable: never by use) */
function profileOrder(a: Fact, b: Fact): number {
    return Number(b.pinned) - Number(a.pinned)
        || b.importance - a.importance
        || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
        || a.createdAt - b.createdAt
        || a.id.localeCompare(b.id);
}

export interface Profile {
    text: string;
    factIds: string[];
}

export function buildProfile(facts: Fact[], maxChars: number, now: number = Date.now(), style?: ProfileStyle): Profile {
    const active = facts.filter(f => f.status === 'active');
    const upcoming = active
        .filter(f => isOpenLoop(f) && f.dueAt !== undefined && f.dueAt >= now - DAY_MS && f.dueAt <= now + UPCOMING_DAYS * DAY_MS)
        .sort((a, b) => a.dueAt! - b.dueAt! || a.id.localeCompare(b.id));
    const upcomingIds = new Set(upcoming.map(f => f.id));
    const known = active.filter(f => !upcomingIds.has(f.id) && !(isOpenLoop(f) && f.dueAt !== undefined)).sort(profileOrder);

    const factIds: string[] = [];
    const take = (lines: string[], fact: Fact, line: string, budget: { left: number }) => {
        if (line.length + 1 > budget.left) return;
        lines.push(line);
        factIds.push(fact.id);
        budget.left -= line.length + 1;
    };

    // Dates first get up to a third of the room: they are what the assistant should follow up on
    const dateBudget = { left: Math.floor(maxChars / 3) };
    const dateLines: string[] = [];
    for (const fact of upcoming) take(dateLines, fact, `- ${isoDay(fact.dueAt!)}: ${fact.subject ? `${fact.subject}: ` : ''}${fact.content}`, dateBudget);

    const factBudget = { left: maxChars - (Math.floor(maxChars / 3) - dateBudget.left) };
    const factLines: string[] = [];
    for (const fact of known) take(factLines, fact, formatFactLine(fact, style), factBudget);

    const texts = style ? PROMPT_TEXTS[style.lang] : null;
    const sections: string[] = [];
    if (factLines.length > 0) {
        sections.push(`${texts ? texts.knownHeader : 'WHAT YOU KNOW ABOUT THE USER (they told you; use it naturally, never recite the list)'}:\n${factLines.join('\n')}`);
    }
    if (dateLines.length > 0) {
        sections.push(`${texts ? texts.comingUpHeader : 'COMING UP FOR THE USER (ask how it went afterwards)'}:\n${dateLines.join('\n')}`);
    }
    return { text: sections.join('\n\n'), factIds };
}

// ─── Relevance ────────────────────────────────────────────────────────────────

const STOPWORDS = new Set((
    'the and for are but not you your with this that have has had was were will would can could should what when where who why how ' +
    'about from they them their there then than into just like also some more most very much does did done been being ' +
    'che chi non per con una uno gli dei delle degli del della dello nel nella nei nelle sul sulla sui come cosa dove quando ' +
    'perché perche sono sei siamo siete hanno hai abbiamo avete era erano fare fatto essere stato anche più piu molto poco ' +
    'questo questa questi queste quello quella quelli quelle mio mia miei mie tuo tua suo sua nostro vostro loro ' +
    'ancora sempre già gia ogni tutto tutti tutta tutte allora però pero quindi oppure ciao grazie ' +
    // Every fact starts with "L'utente" / "The user": not a meaning word
    'utente user'
).split(/\s+/));

/**
 * Word stems of a text: Unicode words (apostrophes split "com'è", "l'ufficio"), stopwords
 * removed, 5-letter prefixes so word forms match ("lavoro" ~ "lavora")
 */
export function stems(text: string): Set<string> {
    const words = text.toLowerCase().normalize('NFKC').match(/\p{L}[\p{L}\p{N}]*/gu) || [];
    const out = new Set<string>();
    for (const word of words) {
        if (word.length < 3 || STOPWORDS.has(word)) continue;
        out.add(word.length > 5 ? word.slice(0, 5) : word);
    }
    return out;
}

/**
 * How well the fact covers the query: shared stems over √(query stems). One shared word is
 * enough for a short question; a long message needs more.
 */
export function keywordScore(query: Set<string>, fact: Fact): number {
    if (query.size === 0) return 0;
    const factStems = stems(`${fact.subject ?? ''} ${fact.content}`);
    let hits = 0;
    query.forEach(s => { if (factStems.has(s)) hits++; });
    return hits / Math.sqrt(query.size);
}

const KEYWORD_THRESHOLD = 0.3;

export interface RelevanceOptions {
    limit: number;
    /** Vectors of the facts and of the query (same embedding model), when available */
    vectors?: { query: Float32Array; facts: Map<string, Float32Array>; minSimilarity: number };
}

/** Active facts most related to the query, best first (excluding `exclude`). */
export function rankRelevantFacts(query: string, facts: Fact[], exclude: Set<string>, options: RelevanceOptions): Fact[] {
    const candidates = facts.filter(f => f.status === 'active' && !exclude.has(f.id));
    const queryStems = stems(query);
    const scored: Array<{ fact: Fact; score: number }> = [];
    for (const fact of candidates) {
        const vector = options.vectors?.facts.get(fact.id);
        const score = vector
            ? cosineSimilarity(options.vectors!.query, vector) >= options.vectors!.minSimilarity
                ? cosineSimilarity(options.vectors!.query, vector) : 0
            : keywordScore(queryStems, fact) >= KEYWORD_THRESHOLD ? keywordScore(queryStems, fact) : 0;
        // A small preference for what matters more to the user
        if (score > 0) scored.push({ fact, score: score + fact.importance * 0.01 });
    }
    return scored
        .sort((a, b) => b.score - a.score || a.fact.id.localeCompare(b.fact.id))
        .slice(0, options.limit)
        .map(s => s.fact);
}

export function formatRelevantFacts(facts: Fact[], style?: ProfileStyle): string {
    if (facts.length === 0) return '';
    const header = style ? PROMPT_TEXTS[style.lang].relatedHeader : 'RELATED THINGS THE USER TOLD YOU';
    return `${header}:\n${facts.map(f => formatFactLine(f, style)).join('\n')}`;
}
