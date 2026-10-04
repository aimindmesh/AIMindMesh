/**
 * The one gate every fact writer goes through (consolidation, save_memory, update_memory):
 * quality, grounding in the user's own words, dates computed by the app, kind and importance
 * rules, near duplicates. On-device models stored questions, notes to themselves, facts taken
 * from the assistant's lines and "tomorrow" plans that were false a day later.
 */
import { Fact, FactKind, clampImportance, isFactKind, normalizeFactText } from './factTypes';
import { cleanSubject, hasRelativeDate, rejectFact } from './factQuality';
import { groundingMessage } from './factGrounding';
import { isPast, resolveWhen } from './dateResolver';
import { guessKind } from './factKind';
import { stems } from '../context/memoryContext';
import { parseDueDate } from './dueDate';

export interface FactCandidate {
    content: unknown;
    kind?: unknown;
    importance?: unknown;
    subject?: unknown;
    /** Date words as the user said them ("sabato", "domani alle 10") */
    when?: unknown;
    /** The user's own words the fact comes from */
    evidence?: unknown;
    /** YYYY-MM-DD from a tool caller (save_memory due_date): used only when no date words resolve */
    due?: unknown;
}

export interface UserLine { text: string; time: number }

export interface GateOptions {
    /** Messages the USER wrote: a fact must come from one of them (consolidation) */
    userMessages?: UserLine[];
    /** When the words were said, for writes without messages (a tool call in the chat) */
    now: number;
    /** Active facts, for duplicates */
    known?: Fact[];
}

export interface GatedFact {
    content: string;
    kind: FactKind;
    importance: number;
    subject?: string;
    dueAt?: number;
}

export type GateReason =
    | 'empty' | 'too-short' | 'too-long' | 'question' | 'meta' | 'about-assistant'
    | 'ungrounded' | 'relative-date' | 'past-event' | 'trivia' | 'duplicate';

export type GateVerdict = { ok: true; fact: GatedFact } | { ok: false; reason: GateReason; duplicateOf?: Fact };

const RECURRING = /\b(ogni|tutti i|tutte le|di solito|every|each|usually)\b/i;
const OPEN_LOOP: FactKind[] = ['commitment', 'event'];
/** Two facts sharing this share of their meaning words say the same thing */
const NEAR_DUPLICATE = 0.8;

const str = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const wordsOf = (text: string) => text.toLowerCase().normalize('NFC').match(/\p{L}+|\p{N}+/gu) || [];

/** Most of the date words appear in the user's message */
function saidIn(when: string, message: string): boolean {
    const wanted = wordsOf(when);
    if (wanted.length === 0) return false;
    const have = new Set(wordsOf(message));
    return wanted.filter(w => have.has(w)).length / wanted.length >= 0.6;
}

/** Local noon of a day start (dates are days, not instants: noon survives time zone shifts) */
const noonOf = (dayStart: number) => dayStart + 12 * 3_600_000;

function nearDuplicate(content: string, dueAt: number | undefined, known: Fact[]): Fact | undefined {
    const normalized = normalizeFactText(content);
    const mine = stems(content);
    for (const fact of known) {
        if (normalizeFactText(fact.content) === normalized) return fact;
        if (mine.size < 2) continue;
        const theirs = stems(fact.content);
        if (theirs.size < 2) continue;
        let shared = 0;
        for (const s of mine) if (theirs.has(s)) shared++;
        const jaccard = shared / (mine.size + theirs.size - shared);
        const sameDay = (dueAt === undefined) === (fact.dueAt === undefined)
            && (dueAt === undefined || Math.abs(dueAt - fact.dueAt!) < 86_400_000);
        if (jaccard >= NEAR_DUPLICATE && sameDay) return fact;
    }
    return undefined;
}

/**
 * Day of the fact: the date words, else the fact itself, else the evidence (only for what may
 * have a date: a beagle named Pepe is not an event because the same sentence says "tomorrow"),
 * else the caller's date.
 */
function resolveDue(candidate: FactCandidate, content: string, evidence: string, refTime: number): number | undefined {
    const datedKind = candidate.kind === 'event' || candidate.kind === 'commitment'
        || (!isFactKind(candidate.kind) || candidate.kind === 'other') && guessKind(content) === 'other';
    for (const words of [str(candidate.when), content, datedKind ? evidence : '']) {
        const day = words ? resolveWhen(words, refTime) : undefined;
        if (day !== undefined) return noonOf(day);
    }
    return parseDueDate(candidate.due);
}

export function gateFact(candidate: FactCandidate, options: GateOptions): GateVerdict {
    const content = str(candidate.content);
    const rejection = rejectFact(content);
    if (rejection) return { ok: false, reason: rejection };

    // Grounding: the user's own words, never the assistant's lines or the prompt
    const evidence = str(candidate.evidence);
    let refTime = options.now;
    let when = str(candidate.when);
    if (options.userMessages) {
        const source = groundingMessage(evidence, content, options.userMessages.map(m => m.text));
        if (source < 0) return { ok: false, reason: 'ungrounded' };
        refTime = options.userMessages[source].time;
        // Date words the user did not write (today's date copied from the prompt) are ignored
        if (when && !saidIn(when, options.userMessages[source].text)) when = '';
    }

    // Dates are computed here from the words, never trusted from the model's arithmetic
    const recurring = RECURRING.test(content) || RECURRING.test(when);
    let dueAt = recurring ? undefined : resolveDue({ ...candidate, when }, content, evidence, refTime);
    if (dueAt === undefined && !recurring && hasRelativeDate(content)) return { ok: false, reason: 'relative-date' };
    if (dueAt !== undefined && isPast(dueAt, refTime)) return { ok: false, reason: 'past-event' };

    let kind: FactKind = isFactKind(candidate.kind) && candidate.kind !== 'other' ? candidate.kind : guessKind(content, dueAt);
    // Where the user lives or works is who they are, whatever the model called it
    if ((kind === 'preference' || kind === 'goal') && guessKind(content) === 'identity') kind = 'identity';
    if (recurring && OPEN_LOOP.includes(kind)) kind = 'routine';
    if (dueAt !== undefined && !OPEN_LOOP.includes(kind)) {
        // A dated fact is something to do or something happening: anything else keeps no date
        const dated = guessKind(content, dueAt);
        if (kind === 'other' || kind === 'goal' || kind === 'project') kind = dated;
        else dueAt = undefined;
    }

    let importance = clampImportance(candidate.importance);
    if (kind === 'other') importance = Math.min(importance, 2);
    if (importance <= 1) return { ok: false, reason: 'trivia' };

    const duplicate = nearDuplicate(content, dueAt, options.known ?? []);
    if (duplicate) return { ok: false, reason: 'duplicate', duplicateOf: duplicate };

    return { ok: true, fact: { content, kind, importance, subject: cleanSubject(str(candidate.subject) || undefined), dueAt } };
}
