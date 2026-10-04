/**
 * One-time review of the facts stored before the fact gate (factGate): questions, notes the
 * model wrote to itself, plans with a relative date and no day, trivia. They are not deleted:
 * they leave the prompt (status 'review') and Settings → Memory lists them for the user to keep
 * or delete. What the user typed in the settings is never flagged.
 */
import { logger } from '../../logger';
import { Fact } from './factTypes';
import { factStore } from './factStore';
import { hasRelativeDate, rejectFact } from './factQuality';

export const REVIEW_KEY = 'facts-review-v1';

/** Why an old fact would not pass the gate today, or null */
export function reviewReason(fact: Fact): string | null {
    if (fact.status !== 'active' || fact.source === 'manual' || fact.pinned) return null;
    const rejected = rejectFact(fact.content);
    if (rejected && rejected !== 'too-long') return rejected;
    if (fact.dueAt === undefined && hasRelativeDate(fact.content)) return 'relative-date';
    if (fact.kind === 'other' && fact.importance <= 1) return 'trivia';
    return null;
}

/** Flags the old junk once; returns how many facts now wait for the user's decision */
export async function markFactsForReview(): Promise<number> {
    await factStore.ready;
    if (await factStore.getMeta(REVIEW_KEY)) return 0;
    let flagged = 0;
    for (const fact of factStore.active()) {
        const reason = reviewReason(fact);
        if (!reason) continue;
        await factStore.setStatus(fact.id, 'review');
        flagged++;
        logger.log('info', `[FactReview] To review (${reason}): "${fact.content.slice(0, 60)}"`);
    }
    await factStore.setMeta(REVIEW_KEY, String(Date.now()));
    return flagged;
}
