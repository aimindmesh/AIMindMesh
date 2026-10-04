/**
 * Text matching for the meeting search: case and accent insensitive ("perche" finds "perché").
 */

import { MeetingSummary } from '../../types/meeting';

/** Lowercase without diacritics, keeping one character per character (so indexes line up). */
export function normalizeForSearch(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Diacritics are separate code points after NFD: map each normalized index back to the original. */
function foldWithIndex(text: string): { folded: string; index: number[] } {
    let folded = '';
    const index: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const plain = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        for (let k = 0; k < plain.length; k++) {
            folded += plain[k];
            index.push(i);
        }
    }
    return { folded, index };
}

/** Position of `query` in `text` ignoring case and accents, as [start, end) in `text`, or null. */
export function findMatch(text: string, query: string): [number, number] | null {
    const q = normalizeForSearch(query.trim());
    if (!q) return null;
    const { folded, index } = foldWithIndex(text);
    const at = folded.indexOf(q);
    if (at < 0) return null;
    return [index[at], index[at + q.length - 1] + 1];
}

export interface Snippet {
    before: string;
    match: string;
    after: string;
}

/** The part of `text` around the first match, cut at word boundaries, for result lists. */
export function snippetAround(text: string, query: string, radius = 60): Snippet | null {
    const range = findMatch(text, query);
    if (!range) return null;
    const [start, end] = range;
    let from = Math.max(0, start - radius);
    let to = Math.min(text.length, end + radius);
    if (from > 0) {
        const space = text.indexOf(' ', from);
        if (space >= 0 && space < start) from = space + 1;
    }
    if (to < text.length) {
        const space = text.lastIndexOf(' ', to);
        if (space > end) to = space;
    }
    return {
        before: (from > 0 ? '…' : '') + text.slice(from, start),
        match: text.slice(start, end),
        after: text.slice(end, to) + (to < text.length ? '…' : '')
    };
}

/** The meeting's own text (title and AI notes) that the search looks at besides the transcript. */
export function notesText(meeting: Pick<MeetingSummary, 'title' | 'analysis' | 'questions'>): string {
    const a = meeting.analysis;
    const parts = [meeting.title];
    if (a) {
        parts.push(a.title, a.summary, a.markdown ?? '');
        parts.push(...a.keyPoints.map(p => p.text), ...a.decisions.map(p => p.text), ...a.openQuestions.map(p => p.text));
        parts.push(...a.actionItems.map(i => [i.task, i.owner, i.due].filter(Boolean).join(' ')));
    }
    parts.push(...meeting.questions.map(q => `${q.question} ${q.answer}`));
    return parts.filter(Boolean).join('\n');
}
