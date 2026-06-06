export interface Chunk {
    content: string;
    page_number?: number;
    chunk_index: number;
}

export type ChunkingStrategy = 'page-level' | 'recursive' | 'semantic';

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
        const pages = text.split(/--- Page \d+ ---/g).filter(p => p.trim().length > 0);
        const pageNumbers = text.match(/--- Page (\d+) ---/g)?.map(m => parseInt(m.match(/\d+/)![0])) || [];

        return pages.flatMap((content, idx) => {
            // Sub-chunk if page is too large
            if (content.length > chunkSize) {
                return this.recursiveSplit(content, chunkSize, overlap).map((subContent, _subIdx) => ({
                    content: subContent.trim(),
                    page_number: pageNumbers[idx] || (idx + 1),
                    chunk_index: 0 // Will be re-indexed later
                }));
            }

            return [{
                content: content.trim(),
                page_number: pageNumbers[idx] || (idx + 1),
                chunk_index: idx
            }];
        }).map((c, i) => ({ ...c, chunk_index: i }));
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
        for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
            finalChunks.push(text.substring(i, i + chunkSize));
        }

        return finalChunks;
    }
}
