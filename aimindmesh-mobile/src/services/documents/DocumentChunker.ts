export interface Chunk {
    content: string;
    page_number?: number;
    chunk_index: number;
}

export type ChunkingStrategy = 'page-level' | 'recursive' | 'semantic';

/** "--- Page N ---" markers (DocumentParser.parsePDF) -> text of each page with its number. */
export function splitPages(text: string): Array<{ page: number; content: string }> {
    const parts = text.split(/--- Page (\d+) ---/g);
    // parts = [before first marker, n1, text1, n2, text2, ...]
    const pages: Array<{ page: number; content: string }> = [];
    for (let i = 1; i + 1 < parts.length; i += 2) {
        pages.push({ page: parseInt(parts[i], 10), content: parts[i + 1] });
    }
    return pages;
}

export class DocumentChunker {

    /**
     * Main chunking method
     */
    async chunk(text: string, strategy: ChunkingStrategy = 'recursive', chunkSize: number = 2000, overlap: number = 200): Promise<Chunk[]> {
        if (strategy === 'page-level' && text.includes('--- Page')) {
            return this.chunkByPage(text, chunkSize, overlap);
        }
        return this.chunkRecursive(text, chunkSize, overlap);
    }

    /**
     * Select best strategy based on file info
     */
    selectStrategy(fileType: string): ChunkingStrategy {
        if (fileType.includes('pdf')) return 'page-level';
        return 'recursive';
    }

    /**
     * Chunk by Page (ideal for PDFs)
     */
    private chunkByPage(text: string, chunkSize: number = 2000, overlap: number = 200): Chunk[] {
        // Each page keeps the number of its own marker: empty pages (scans, image-only covers)
        // are dropped only after pairing, so they no longer shift the following pages
        const pages = splitPages(text).filter(p => p.content.trim().length > 0);

        return pages.flatMap(({ content, page }) => {
            // Sub-chunk if page is too large
            if (content.length > chunkSize) {
                return this.recursiveSplit(content, chunkSize, overlap).map(subContent => ({
                    content: subContent.trim(),
                    page_number: page,
                    chunk_index: 0 // Will be re-indexed later
                }));
            }

            return [{
                content: content.trim(),
                page_number: page,
                chunk_index: 0
            }];
        }).filter(c => c.content.length > 0).map((c, i) => ({ ...c, chunk_index: i }));
    }

    /**
     * Recursive Character Text Splitter logic
     */
    private chunkRecursive(text: string, chunkSize: number = 2000, overlap: number = 200): Chunk[] {
        const chunks = this.recursiveSplit(text, chunkSize, overlap);
        return chunks.map((content, idx) => ({
            content,
            chunk_index: idx
        }));
    }

    private recursiveSplit(text: string, chunkSize: number = 2000, overlap: number = 200): string[] {
        if (text.length <= chunkSize) return [text];

        let finalChunks: string[] = [];

        // Simple implementation for demonstration
        // In production, use a more robust recursive splitter
        // (step >= 1: an overlap >= chunk size looped forever; stop once the end is covered,
        // a further window would only repeat the overlap)
        const step = Math.max(1, chunkSize - overlap);
        for (let i = 0; i < text.length; i += step) {
            finalChunks.push(text.substring(i, i + chunkSize));
            if (i + chunkSize >= text.length) break;
        }

        return finalChunks;
    }
}
