/**
 * Memory consolidation: new chat messages are read in batches, when the chat is quiet, and
 * turned into operations on the facts — add a new fact, update (supersede) a known one, mark
 * an open loop done. The model sees the related known facts, so it updates instead of
 * duplicating. Every operation is validated; nothing the model returns is stored blindly.
 */
import { Message } from '../../../types';
import { logger } from '../../logger';
import { Fact, FactKind, isFactKind, isOpenLoop, normalizeFactText } from './factTypes';
import { factStore } from './factStore';
import { rankRelevantFacts } from '../context/memoryContext';
import { gateFact, type UserLine } from './factGate';
import { groundingMessage } from './factGrounding';
import { MAX_OPS } from './consolidationPrompt';

const KNOWN_RELATED = 10;
const KNOWN_OPEN_LOOPS = 5;
/** Open loops this old (past their date) are expired */
const EXPIRE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export interface FactOp {
    op: 'add' | 'update' | 'done';
    ref?: string;
    kind?: FactKind;
    content?: string;
    importance?: number;
    subject?: string;
    /** Local date, YYYY-MM-DD (old schema; the date now comes from "when") */
    due?: string;
    /** Date words as the user said them */
    when?: string;
    /** The user's words the operation comes from */
    evidence?: string;
    category?: string;
}

export interface ValidOp {
    op: 'add' | 'update' | 'done';
    target?: Fact;
    kind: FactKind;
    content: string;
    importance: number;
    subject?: string;
    dueAt?: number;
    category?: string;
}

/** Messages worth reading: what the user and the assistant said (no hidden triggers, tools, errors) */
export function consolidationMessages(messages: Message[]): Message[] {
    return messages.filter(m =>
        (m.role === 'user' || m.role === 'model') && !m.hidden && !m.isSummary && m.text?.trim()
        && !m.id?.startsWith('tool_') && !m.id?.startsWith('nudge_')
        && !m.text.startsWith('Sorry, I encountered an error'));
}

/** Messages after the cursor (the last one already read); the tail when the cursor is gone */
export function messagesAfterCursor(messages: Message[], cursorId: string | null, fallbackTail = 12): Message[] {
    const readable = consolidationMessages(messages);
    if (!cursorId) return readable.slice(-fallbackTail);
    const index = readable.findIndex(m => m.id === cursorId);
    return index >= 0 ? readable.slice(index + 1) : readable.slice(-fallbackTail);
}

/** Consecutive batches of at most `maxChars` characters (a message longer than that is cut) */
export function batchMessages(messages: Message[], maxChars: number): Message[][] {
    const batches: Message[][] = [];
    let current: Message[] = [];
    let size = 0;
    for (const message of messages) {
        const length = Math.min(message.text.length, maxChars);
        if (current.length > 0 && size + length > maxChars) {
            batches.push(current);
            current = [];
            size = 0;
        }
        current.push(message);
        size += length;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

export { MAX_OPS, CONSOLIDATION_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPTS, FACT_OPS_GRAMMAR, buildConsolidationPrompt, localDay } from './consolidationPrompt';

/** Operations in the model's answer (tolerates code fences and text around the JSON) */
export function parseOps(text: string): FactOp[] {
    const cleaned = text.replace(/```(?:json)?/gi, '');
    const start = cleaned.search(/[[{]/);
    if (start < 0) return [];
    const close = cleaned[start] === '{' ? '}' : ']';
    for (let end = cleaned.lastIndexOf(close); end > start; end = cleaned.lastIndexOf(close, end - 1)) {
        try {
            const parsed = JSON.parse(cleaned.slice(start, end + 1));
            const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
            return Array.isArray(ops) ? ops.filter((o: unknown) => o && typeof o === 'object') : [];
        } catch {
            // Text after the JSON: try a shorter span
        }
    }
    return [];
}

export { parseDueDate } from './dueDate';

export interface ValidateOptions {
    /** Messages the operations come from: facts must be grounded in what the USER wrote */
    batch?: Message[];
    /** Active facts (near duplicates); default the known ones */
    active?: Fact[];
    now?: number;
}

/** User lines of a batch with their time (the reference for "tomorrow") */
function userLines(batch: Message[], now: number): UserLine[] {
    return batch.filter(m => m.role === 'user').map(m => ({ text: m.text, time: new Date(m.timestamp).getTime() || now }));
}

/**
 * Operations worth applying: each one through the fact gate (quality, grounding, dates, kind,
 * duplicates). Rejections are logged with their reason.
 */
export function validateOps(ops: FactOp[], known: Fact[], categories: string[] = [], options: ValidateOptions = {}): ValidOp[] {
    const now = options.now ?? Date.now();
    const lines = options.batch ? userLines(options.batch, now) : undefined;
    const active = [...(options.active ?? known)];
    const valid: ValidOp[] = [];
    const byRef = (ref: unknown) => typeof ref === 'string' && /^F\d+$/.test(ref.trim()) ? known[Number(ref.trim().slice(1)) - 1] : undefined;
    const rejected: string[] = [];
    for (const raw of ops) {
        if (valid.length >= MAX_OPS) break; // invalid ones do not use up the budget
        // Small models put the kind in "op" ({"op":"event",…}): an add of that kind
        const op: FactOp = isFactKind(raw.op) ? { ...raw, op: 'add', kind: isFactKind(raw.kind) ? raw.kind : raw.op } : raw;
        const target = byRef(op.ref);
        if (op.op === 'done') {
            const grounded = !lines || groundingMessage(op.evidence, target?.content ?? '', lines.map(l => l.text)) >= 0;
            if (target && isOpenLoop(target) && grounded) valid.push({ op: 'done', target, kind: target.kind, content: target.content, importance: target.importance });
            else rejected.push(`done ${op.ref}`);
            continue;
        }
        if (op.op !== 'add' && op.op !== 'update') continue;
        if (op.op === 'update' && !target) continue;
        const verdict = gateFact(
            op.op === 'update'
                ? { content: op.content, kind: target!.kind, importance: target!.importance, subject: target!.subject, when: op.when, evidence: op.evidence }
                : { content: op.content, kind: op.kind, importance: op.importance, subject: op.subject, when: op.when, evidence: op.evidence },
            { userMessages: lines, now, known: op.op === 'update' ? active.filter(f => f.id !== target!.id) : active },
        );
        if (!verdict.ok) {
            rejected.push(`${verdict.reason}: ${String(op.content ?? '').slice(0, 60)}`);
            continue;
        }
        const fact = verdict.fact;
        if (op.op === 'update') {
            if (normalizeFactText(target!.content) === normalizeFactText(fact.content)) continue;
            valid.push({ op: 'update', target, kind: target!.kind, content: fact.content, importance: target!.importance, dueAt: fact.dueAt ?? target!.dueAt });
            continue;
        }
        // Later operations of the same answer must not repeat this one
        active.push({ id: `new-${valid.length}`, kind: fact.kind, content: fact.content, dueAt: fact.dueAt, status: 'active' } as Fact);
        valid.push({
            op: 'add', kind: fact.kind, content: fact.content, importance: fact.importance, subject: fact.subject, dueAt: fact.dueAt,
            category: typeof op.category === 'string' && categories.includes(op.category) ? op.category : undefined,
        });
    }
    if (rejected.length > 0) logger.log('info', `[Consolidation] Rejected: ${rejected.join(' | ')}`);
    return valid;
}

export interface ApplyResult { added: number; updated: number; done: number; skipped: number }

/** Applies the operations; one on a fact edited meanwhile (e.g. by the user) is skipped. */
export async function applyOps(ops: ValidOp[], threadId: string | null): Promise<ApplyResult> {
    const result: ApplyResult = { added: 0, updated: 0, done: 0, skipped: 0 };
    for (const op of ops) {
        const current = op.target ? factStore.get(op.target.id) : undefined;
        const changed = !current || current.updatedAt !== op.target?.updatedAt || current.content !== op.target?.content || current.status !== 'active';
        if (op.target && changed) {
            result.skipped++;
            continue;
        }
        if (op.op === 'done') {
            await factStore.setStatus(op.target!.id, 'done');
            result.done++;
        } else if (op.op === 'update') {
            await factStore.supersede(op.target!.id, { content: op.content, dueAt: op.dueAt, source: 'extracted', sourceThread: threadId ?? undefined });
            result.updated++;
        } else {
            const added = await factStore.add({
                kind: op.kind, content: op.content, importance: op.importance, subject: op.subject, dueAt: op.dueAt,
                category: op.category, source: 'extracted', confidence: 0.8, sourceThread: threadId ?? undefined,
            });
            if (added && !added.duplicate) result.added++;
            else result.skipped++;
        }
    }
    return result;
}

/** Facts the model should know before reading `batch`: the related ones and the open loops */
export function knownFactsFor(batch: Message[], facts: Fact[]): Fact[] {
    const text = batch.filter(m => m.role === 'user').map(m => m.text).join(' ');
    const related = rankRelevantFacts(text, facts, new Set(), { limit: KNOWN_RELATED });
    const openLoops = facts.filter(isOpenLoop).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, KNOWN_OPEN_LOOPS);
    const seen = new Set<string>();
    return [...related, ...openLoops].filter(f => !seen.has(f.id) && !!seen.add(f.id));
}

/** Commitments and events whose date passed two days ago: no longer "coming up" */
export async function expireOpenLoops(now: number = Date.now()): Promise<number> {
    const stale = factStore.active().filter(f => isOpenLoop(f) && f.dueAt !== undefined && f.dueAt < now - EXPIRE_AFTER_MS);
    for (const fact of stale) await factStore.setStatus(fact.id, 'expired');
    if (stale.length > 0) logger.log('info', `[Consolidation] ${stale.length} open loops expired`);
    return stale.length;
}
