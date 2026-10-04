/**
 * Memory Tools: the assistant's own access to the facts it knows about the user.
 */

import { ToolResult } from './types';
import { factStore } from '../memory/facts/factStore';
import { Fact, isOpenLoop, KIND_LABELS } from '../memory/facts/factTypes';
import { rankRelevantFacts } from '../memory/context/memoryContext';
import { gateFact, type GateReason } from '../memory/facts/factGate';
import { recallFacts } from '../memory/context/recallQuestion';

const MAX_RESULTS = 8;

export async function executeSaveMemory(args: Record<string, unknown>): Promise<ToolResult> {
    await factStore.ready;
    // Same gate as the consolidation: quality, dates computed from the words ("sabato"), kind
    const verdict = gateFact(
        { content: args.content, kind: args.kind, importance: args.importance, subject: args.about, due: args.due_date },
        { now: Date.now(), known: factStore.active() },
    );
    if (!verdict.ok) {
        if (verdict.duplicateOf) return { success: true, message: `Already known: "${verdict.duplicateOf.content}"`, data: { id: verdict.duplicateOf.id } };
        return { success: false, message: `Not saved (${GATE_MESSAGES[verdict.reason] ?? verdict.reason})` };
    }
    const { fact } = verdict;
    const result = await factStore.add({
        content: fact.content, kind: fact.kind, importance: fact.importance, dueAt: fact.dueAt, subject: fact.subject,
        source: 'tool', confidence: 0.9,
    });
    if (!result) return { success: false, message: 'The memory is too short' };
    return {
        success: true,
        message: result.duplicate ? `Already known: "${result.fact.content}"` : `Saved to memory: "${result.fact.content}"`,
        data: { id: result.fact.id },
    };
}

/** Why the gate refused a fact, in words the model can act on */
const GATE_MESSAGES: Partial<Record<GateReason, string>> = {
    question: 'a question is not a fact about the user',
    meta: 'write the fact itself, one plain sentence',
    'about-assistant': 'facts are about the user, not the assistant',
    'relative-date': 'say on which day: the date could not be worked out',
    'past-event': 'the date has already passed',
    trivia: 'not worth remembering',
};

export async function executeSearchMemory(args: Record<string, unknown>): Promise<ToolResult> {
    await factStore.ready;
    const query = typeof args.query === 'string' ? args.query : '';
    const active = factStore.active();
    const found = rankRelevantFacts(query, active, new Set(), { limit: MAX_RESULTS });
    const line = (f: Fact) => {
        const due = f.dueAt ? `, ${new Date(f.dueAt).toISOString().slice(0, 10)}${isOpenLoop(f) ? '' : ' (closed)'}` : '';
        return `[${f.id}] (${KIND_LABELS[f.kind].toLowerCase()}${due}) ${f.subject ? `${f.subject}: ` : ''}${f.content}`;
    };
    if (found.length === 0) {
        // No word in common ("where do I live?"): the model still needs what is known to answer
        // "you have not told me, but I know you run in…" instead of "I know nothing"
        const known = recallFacts([], active, new Set(), MAX_RESULTS);
        if (known.length === 0) return { success: true, message: 'No memory about this: the user has not told you yet.' };
        return {
            success: true,
            message: `Nothing about this exactly: the user has not told you. What you know about them:\n${known.map(line).join('\n')}`,
            data: { ids: known.map(f => f.id) },
        };
    }
    return { success: true, message: found.map(line).join('\n'), data: { ids: found.map(f => f.id) } };
}

export async function executeUpdateMemory(args: Record<string, unknown>): Promise<ToolResult> {
    const id = typeof args.memory_id === 'string' ? args.memory_id.trim() : '';
    const content = typeof args.content === 'string' ? args.content.trim() : '';
    if (!id || !content) return { success: false, message: 'memory_id and content are required' };
    await factStore.ready;
    const current = factStore.get(id);
    if (!current) return { success: false, message: `No memory with id ${id}` };
    const verdict = gateFact(
        { content, kind: current.kind, importance: current.importance, subject: current.subject },
        { now: Date.now(), known: factStore.active().filter(f => f.id !== id) },
    );
    if (!verdict.ok && verdict.reason !== 'duplicate') {
        return { success: false, message: `Not updated (${GATE_MESSAGES[verdict.reason] ?? verdict.reason})` };
    }
    const dueAt = verdict.ok ? verdict.fact.dueAt ?? current.dueAt : current.dueAt;
    const updated = await factStore.supersede(id, { content: verdict.ok ? verdict.fact.content : content, dueAt, source: 'tool' });
    return updated
        ? { success: true, message: `Memory updated: "${updated.content}"`, data: { id: updated.id } }
        : { success: false, message: `No memory with id ${id}` };
}

export async function executeForgetMemory(args: Record<string, unknown>): Promise<ToolResult> {
    const id = typeof args.memory_id === 'string' ? args.memory_id.trim() : '';
    await factStore.ready;
    const fact = id ? factStore.get(id) : undefined;
    if (!fact) return { success: false, message: `No memory with id ${id}` };
    await factStore.remove([id]);
    return { success: true, message: `Forgotten: "${fact.content}"` };
}
