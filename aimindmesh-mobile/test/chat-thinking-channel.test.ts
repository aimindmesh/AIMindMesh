import { describe, expect, it } from 'vitest';
import { createThinkingParser } from '../src/services/llm/thinkingParser';

const parse = (raw: string, size: number) => {
    const p = createThinkingParser();
    let text = '', thinking = '';
    const take = (c: { type: string; content?: string }) => { if (c.type === 'text') text += c.content; else if (c.type === 'thinking') thinking += c.content; };
    for (let i = 0; i < raw.length; i += size) for (const c of p.processChunk(raw.slice(i, i + size))) take(c);
    for (const c of p.flush()) take(c);
    return { text, thinking };
};

describe('thinking blocks in a token stream', () => {
    // Gemma 4 writes "Answer:" inside its thought channel; the stream arrives a few characters at a time
    const raw = "<|channel>thought\nThinking Process:\n1. **Analyze:** the user asks about the dog.\n4. **Formulate the Answer:** short and in Italian.\n5. **Draft Response:** Si chiama Pepe.<channel|>Il tuo cane si chiama Pepe.";

    it.each([1, 3, 7, 500])('keeps the thought out of the answer (chunks of %i)', size => {
        const { text, thinking } = parse(raw, size);
        expect(text).toBe('Il tuo cane si chiama Pepe.');
        expect(thinking).toContain('Formulate the Answer:');
    });

    it('an implicit block still ends at "Answer:" on its own line', () => {
        expect(parse('Thinking Process: check the date.\nAnswer: Oggi è domenica.', 2).text.trim()).toBe('Answer: Oggi è domenica.');
    });
});
