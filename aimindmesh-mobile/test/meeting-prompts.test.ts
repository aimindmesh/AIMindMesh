import { describe, expect, it } from 'vitest';
import {
    buildQuestionPrompt,
    buildTranscriptAnalysisPrompt,
    formatClock,
    formatTranscriptForPrompt,
    guessLanguage,
    parseAnalysis,
    parseClock
} from '../src/services/llm/meetingPrompts';
import { TranscriptSegment } from '../src/types/meeting';

const meta = { source: 'transcript' as const, model: 'test-model', createdAt: 1 };

const seg = (id: string, speakerId: number, startMs: number, text: string): TranscriptSegment =>
    ({ id, speakerId, text, timestamp: 0, start_ms: startMs, end_ms: startMs + 2000 });

describe('clock times', () => {
    it('formats and parses m:ss and h:mm:ss', () => {
        expect(formatClock(0)).toBe('0:00');
        expect(formatClock(754_900)).toBe('12:34');
        expect(formatClock(3_723_000)).toBe('1:02:03');
        expect(parseClock('12:34')).toBe(754_000);
        expect(parseClock('[1:02:03]')).toBe(3_723_000);
        expect(parseClock('00:05')).toBe(5_000);
    });

    it('rejects what is not a time', () => {
        expect(parseClock('12:75')).toBeUndefined();
        expect(parseClock('soon')).toBeUndefined();
        expect(parseClock(null)).toBeUndefined();
    });
});

describe('guessLanguage', () => {
    it('recognizes Italian and English meetings', () => {
        expect(guessLanguage('Allora, per il progetto non è ancora chiaro che cosa fare, ma la data è questa e poi vediamo')).toBe('it');
        expect(guessLanguage('So the budget is not final and we have to check what the team can do for this release')).toBe('en');
    });

    it('gives up on too little text', () => {
        expect(guessLanguage('ok grazie')).toBeUndefined();
    });
});

describe('prompts', () => {
    const transcript = [seg('a', 0, 5_000, 'Iniziamo dal budget.'), seg('b', 1, 65_000, '  '), seg('c', 1, 70_000, 'Va bene.')];

    it('labels lines with time and speaker, skipping empty ones', () => {
        expect(formatTranscriptForPrompt(transcript, { 1: 'Marco' })).toBe('[0:05] Speaker 1: Iniziamo dal budget.\n[1:10] Marco: Va bene.');
    });

    it('asks for the meeting language and mentions the marked moments', () => {
        const prompt = buildTranscriptAnalysisPrompt({ transcript, speakerNames: {}, bookmarks: [{ id: 'b', ms: 70_000 }], language: 'it' });
        expect(prompt).toContain('in Italian');
        expect(prompt).toContain('marked these moments as important: 1:10');
        expect(prompt).toContain('[1:10] Speaker 2: Va bene.');
    });

    it('keeps only the last questions as context', () => {
        const previous = Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, question: `Q${i}?`, answer: `A${i}`, createdAt: i }));
        const prompt = buildQuestionPrompt({ transcript, speakerNames: {} }, previous, 'Chi decide?');
        expect(prompt).not.toContain('Q1?');
        expect(prompt).toContain('Q6?');
        expect(prompt.trim().endsWith('QUESTION: Chi decide?')).toBe(true);
    });
});

describe('parseAnalysis', () => {
    it('reads the structured notes, with times', () => {
        const raw = '```json\n' + JSON.stringify({
            title: 'Budget Q3',
            summary: 'Si è deciso il budget.',
            keyPoints: [{ text: 'Costi in aumento', at: '0:05' }, 'Nuovo fornitore'],
            decisions: [{ text: 'Budget approvato', at: '1:10' }],
            actionItems: [{ task: 'Inviare il preventivo', owner: 'Marco', due: 'venerdì', at: '1:10' }, { task: 'Chiamare il fornitore', owner: 'null', due: 'N/A' }],
            openQuestions: []
        }) + '\n```';
        const analysis = parseAnalysis(raw, meta);

        expect(analysis.title).toBe('Budget Q3');
        expect(analysis.keyPoints).toEqual([{ text: 'Costi in aumento', atMs: 5_000 }, { text: 'Nuovo fornitore' }]);
        expect(analysis.decisions).toEqual([{ text: 'Budget approvato', atMs: 70_000 }]);
        expect(analysis.actionItems).toEqual([
            { task: 'Inviare il preventivo', owner: 'Marco', due: 'venerdì', atMs: 70_000 },
            { task: 'Chiamare il fornitore' }
        ]);
        expect(analysis.markdown).toBeUndefined();
        expect(analysis.model).toBe('test-model');
    });

    it('tolerates text around the JSON and snake_case keys', () => {
        const analysis = parseAnalysis('Here are the notes:\n{"summary": "S", "action_items": ["Do it"]}\nThanks', meta);
        expect(analysis.summary).toBe('S');
        expect(analysis.actionItems).toEqual([{ task: 'Do it' }]);
    });

    it('keeps an answer that is not JSON as markdown', () => {
        const analysis = parseAnalysis('### Summary\nThe team agreed.', meta);
        expect(analysis.markdown).toBe('### Summary\nThe team agreed.');
        expect(analysis.summary).toBe('');
    });

    it('keeps a truncated JSON answer as markdown', () => {
        const analysis = parseAnalysis('{"title": "T", "summary": "Long summary that was cut', meta);
        expect(analysis.markdown).toContain('Long summary');
    });
});
