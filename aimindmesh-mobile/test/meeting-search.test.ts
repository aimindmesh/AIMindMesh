import { describe, expect, it } from 'vitest';
import { findMatch, notesText, snippetAround } from '../src/services/meeting/meetingSearch';
import { bookmarksFromPositions, displayTitle, mergeBookmarks, notesFromRow, notesToRow } from '../src/services/meeting/meetingNotes';

describe('findMatch', () => {
    it('ignores case and accents', () => {
        expect(findMatch('Ma perché NO?', 'perche')).toEqual([3, 9]);
        expect(findMatch('Ma perché NO?', 'PERCHÉ no')).toEqual([3, 12]);
        expect(findMatch('Città', 'citta')).toEqual([0, 5]);
    });

    it('returns null when absent or empty', () => {
        expect(findMatch('budget', 'costi')).toBeNull();
        expect(findMatch('budget', '   ')).toBeNull();
    });

    it('maps positions back through decomposed accents', () => {
        const decomposed = 'café latte'; // "café" with a combining accent
        const range = findMatch(decomposed, 'latte')!;
        expect(decomposed.slice(range[0], range[1])).toBe('latte');
    });
});

describe('snippetAround', () => {
    it('cuts long text around the match at word boundaries', () => {
        const text = 'Prima parte del discorso molto lunga, poi parliamo del budget del terzo trimestre e infine dei costi del personale.';
        const snippet = snippetAround(text, 'budget', 20)!;
        expect(snippet.match).toBe('budget');
        expect(snippet.before.startsWith('…')).toBe(true);
        expect(snippet.after.endsWith('…')).toBe(true);
        expect(snippet.before + snippet.match + snippet.after).toContain('del budget del terzo');
    });

    it('keeps short text whole', () => {
        expect(snippetAround('Va bene il budget', 'budget')).toEqual({ before: 'Va bene il ', match: 'budget', after: '' });
    });
});

describe('notesText', () => {
    it('collects the title, the AI notes and the questions', () => {
        const text = notesText({
            title: 'Riunione fornitori',
            analysis: {
                title: 'T', summary: 'Sintesi', keyPoints: [{ text: 'Punto' }], decisions: [], openQuestions: [],
                actionItems: [{ task: 'Chiamare', owner: 'Anna' }], source: 'transcript', model: 'm', createdAt: 0
            },
            questions: [{ id: 'q', question: 'Chi?', answer: 'Marco', createdAt: 0 }]
        });
        for (const word of ['Riunione fornitori', 'Sintesi', 'Punto', 'Chiamare Anna', 'Marco']) {
            expect(text).toContain(word);
        }
    });
});


describe('meeting notes storage', () => {
    it('round-trips notes through the database columns', () => {
        const notes = {
            title: ' Budget ',
            bookmarks: [{ id: 'b', ms: 1000 }],
            analysis: null,
            questions: [{ id: 'q', question: 'Q?', answer: 'A', createdAt: 1 }]
        };
        const row = notesToRow(notes);
        expect(row.title).toBe('Budget');
        expect(row.analysis_json).toBeNull();
        expect(notesFromRow(row as any)).toEqual({ ...notes, title: 'Budget' });
    });

    it('reads damaged or missing columns as empty notes', () => {
        expect(notesFromRow({ title: null, bookmarks_json: '{oops', analysis_json: undefined, questions_json: '"x"' } as any))
            .toEqual({ title: '', bookmarks: [], analysis: null, questions: [] });
    });

    it('only writes the fields it is given', () => {
        expect(notesToRow({ bookmarks: [] })).toEqual({ bookmarks_json: null });
    });
});

describe('mergeBookmarks', () => {
    it('adds new moments in time order and skips the same moment seen twice', () => {
        const merged = mergeBookmarks(
            [{ id: 'a', ms: 60_000 }],
            bookmarksFromPositions([10_000, 60_800, 90_000])
        );
        expect(merged.map(b => b.ms)).toEqual([10_000, 60_000, 90_000]);
        expect(merged[1].id).toBe('a');
    });
});

describe('displayTitle', () => {
    it("prefers the user's title, then the AI's, then the date", () => {
        const analysis = { title: 'AI title' } as any;
        expect(displayTitle({ timestamp: 0, title: 'Mine', analysis })).toBe('Mine');
        expect(displayTitle({ timestamp: 0, title: '', analysis })).toBe('AI title');
        expect(displayTitle({ timestamp: 0, title: '', analysis: null })).toMatch(/^Meeting of /);
    });
});
