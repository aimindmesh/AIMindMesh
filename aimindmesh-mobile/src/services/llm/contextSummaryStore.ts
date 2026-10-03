import { Message } from '../../types';

/**
 * Context summaries ("Auto-Summarize Context") are kept beside the conversation, never in it:
 * the saved thread keeps every original message, and only the history sent to the model has
 * the covered part replaced by the summary.
 */

const STORAGE_KEY = 'context-summaries';
const MAX_SUMMARIES = 50;

export interface ContextSummary {
    threadId: string;
    summary: string;
    /** Id of the last message the summary covers */
    coversUpToId: string;
    createdAt: number;
}

function readAll(): Record<string, ContextSummary> {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function getContextSummary(threadId: string | null | undefined): ContextSummary | null {
    if (!threadId) return null;
    return readAll()[threadId] ?? null;
}

/** Stores the summary of a thread (the newest MAX_SUMMARIES threads are kept). */
export function saveContextSummary(summary: ContextSummary): void {
    const all = readAll();
    all[summary.threadId] = summary;
    const kept = Object.values(all).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SUMMARIES);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept.map(s => [s.threadId, s]))));
    } catch (error) {
        // Storage full: the model just gets the full history, nothing is lost
        console.warn('[ContextSummary] Summary not stored', error);
    }
}

export function clearContextSummary(threadId: string): void {
    const all = readAll();
    if (!(threadId in all)) return;
    delete all[threadId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** The summary as the first message of the model history (never shown in the chat). */
export function summaryMessage(summary: ContextSummary): Message {
    return {
        id: `summary-${summary.threadId}`,
        role: 'system',
        text: `[Context Summary] Previous conversation covered:\n\n${summary.summary}`,
        timestamp: new Date(summary.createdAt),
        hidden: true,
        isSummary: true,
    };
}

/**
 * History as the model should see it: the messages covered by the thread's summary replaced
 * by the summary. If the covered messages are gone (chat cleared or edited), the summary no
 * longer applies and the history is returned as it is.
 */
export function applyContextSummary(messages: Message[], threadId: string | null | undefined): Message[] {
    const summary = getContextSummary(threadId);
    if (!summary) return messages;
    const index = messages.findIndex(m => m.id === summary.coversUpToId);
    if (index < 0) return messages;
    return [summaryMessage(summary), ...messages.slice(index + 1)];
}
