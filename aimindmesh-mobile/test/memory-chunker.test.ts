import { describe, expect, it } from 'vitest';
import { DocumentChunker, splitPages } from '../src/services/documents/DocumentChunker';

/** Same layout as DocumentParser.parsePDF */
const pdfText = (pages: string[]) => pages.map((text, i) => `\n--- Page ${i + 1} ---\n${text}`).join('');

describe('document chunker', () => {
    it('keeps each page number when some pages have no text', async () => {
        const text = pdfText(['', 'Introduction text', '   ', 'Results text']);
        expect(splitPages(text).map(p => p.page)).toEqual([1, 2, 3, 4]);

        const chunks = await new DocumentChunker().chunk(text, 'page-level', 2000, 200);
        expect(chunks.map(c => [c.page_number, c.content])).toEqual([[2, 'Introduction text'], [4, 'Results text']]);
        expect(chunks.map(c => c.chunk_index)).toEqual([0, 1]);
    });

    it('sub-chunks long pages under their own page number', async () => {
        const text = pdfText(['', 'x'.repeat(2500)]);
        const chunks = await new DocumentChunker().chunk(text, 'page-level', 1000, 100);
        expect(chunks.length).toBeGreaterThan(1);
        expect(new Set(chunks.map(c => c.page_number))).toEqual(new Set([2]));
    });

    it('terminates when the overlap is not smaller than the chunk size', async () => {
        const chunks = await new DocumentChunker().chunk('a'.repeat(50), 'recursive', 10, 10);
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.length).toBeLessThanOrEqual(50);
    });

    it('does not add a tail chunk that only repeats the overlap', async () => {
        const chunks = await new DocumentChunker().chunk('b'.repeat(3700), 'recursive', 2000, 200);
        expect(chunks.map(c => c.content.length)).toEqual([2000, 1900]);
    });
});
