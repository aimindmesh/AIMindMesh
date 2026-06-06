import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { TextEmbedding } from 'text-embedding-capacitor';
import { logger } from '../logger';
import { workspaceService } from '../workspaces/WorkspaceService';

export interface RetrievalResult {
    id: number;
    document_id: number;
    document_title?: string;
    content: string;
    page_number?: number;
    score: number; // Fusion score
    distance?: number; // Vector distance (1 - similarity)
    chunk_metadata?: any;
}

export class DocumentRetriever {

    /**
     * Search within a specific workspace (or all if null) using Hybrid RRF
     */
    async hybridSearchInWorkspace(
        query: string,
        workspaceId: number | null,
        topK: number = 5
    ): Promise<RetrievalResult[]> {
        const start = performance.now();

        // 1. FTS5 Search (Keyword)
        const ftsResults = await this.keywordSearch(query, workspaceId, topK * 2);

        // 2. Vector Search (Semantic)
        let vecResults: RetrievalResult[] = [];
        try {
            const embeddingResult = await TextEmbedding.generateEmbedding({ text: query });
            const queryVec = new Float32Array(embeddingResult.embedding);
            vecResults = await this.vectorSearch(queryVec, workspaceId, topK * 2);
        } catch (e) {
            logger.log('error', '[Retriever] Vector search failed, falling back to keyword only', e);
            // Fallback: return FTS results if vector fails
            return ftsResults.slice(0, topK);
        }

        // 3. Fusion (RRF)
        const fused = this.fuseResults(ftsResults, vecResults);

        // 4. Sort and Limit
        const finalResults = fused
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        logger.log('info', `[Retriever] Hybrid search completed in ${(performance.now() - start).toFixed(0)}ms. Found ${finalResults.length} results.`);
        return finalResults;
    }

    // Helper for auto-retrieve based on active workspace settings
    async autoRetrieve(query: string): Promise<RetrievalResult[]> {
        const mode = workspaceService.getContextMode();

        // 1. If Context Disabled (None), return nothing
        if (mode === 'NONE') {
            return [];
        }

        const activeWorkspace = workspaceService.getActiveWorkspace();

        // 2. If Global Context, search everything (null ID)
        if (mode === 'GLOBAL' || !activeWorkspace) {
            // For global search, we use default settings since we don't have workspace settings
            // Default to 5 chunks, standard search
            return this.hybridSearchInWorkspace(query, null, 5);
        }

        // 3. Workspace Context
        if (!activeWorkspace.settings.auto_inject) {
            return [];
        }

        if (activeWorkspace.settings.search_strategy === 'keyword') {
            const fts = await this.keywordSearch(query, activeWorkspace.id, activeWorkspace.settings.max_chunks);
            return fts.map(r => ({ ...r, score: 1 }));
        }

        return this.hybridSearchInWorkspace(
            query,
            activeWorkspace.id,
            activeWorkspace.settings.max_chunks
        );
    }

    private async keywordSearch(query: string, workspaceId: number | null, limit: number): Promise<RetrievalResult[]> {
        const db = await getKnowledgeDatabase();

        let sql = `
      SELECT 
        dc.id, 
        dc.content, 
        dc.document_id,
        d.title as document_title,
        dc.page_number,
        dc.chunk_metadata
      FROM document_chunks_fts fts
      JOIN document_chunks dc ON fts.rowid = dc.id
      JOIN documents d ON d.id = dc.document_id
      WHERE document_chunks_fts MATCH ? 
    `;

        const sanitizedQuery = this.sanitizeFtsQuery(query);
        const params: any[] = [sanitizedQuery];

        if (workspaceId) {
            sql += ` AND dc.document_id IN (SELECT document_id FROM workspace_documents WHERE workspace_id = ?) `;
            params.push(workspaceId);
        }

        sql += ` ORDER BY rank LIMIT ?`;
        params.push(limit);

        try {
            const result = await db.query(sql, params);
            return (result.values || []).map(row => ({
                id: row.id,
                document_id: row.document_id,
                document_title: row.document_title,
                content: row.content,
                page_number: row.page_number,
                score: 0, // Calculated in fusion
                chunk_metadata: row.chunk_metadata ? JSON.parse(row.chunk_metadata) : {}
            }));
        } catch (e) {
            logger.log('warn', '[Retriever] Keyword search failed', e);
            return [];
        }
    }

    private async vectorSearch(queryVec: Float32Array, workspaceId: number | null, limit: number): Promise<RetrievalResult[]> {
        const db = await getKnowledgeDatabase();

        // Fetch all chunks embeddings for this workspace
        // Optimization: In real production, use sqlite-vec or ANNOY/HNSW index.
        // Here we use brute-force in JS (acceptable for <10k chunks)
        let sql = `
      SELECT 
        dc.id, 
        dc.content, 
        dc.document_id,
        dc.embedding,
        d.title as document_title,
        dc.page_number
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
    `;

        const params: any[] = [];
        if (workspaceId) {
            sql += ` WHERE dc.document_id IN (SELECT document_id FROM workspace_documents WHERE workspace_id = ?)`;
            params.push(workspaceId);
        }

        const result = await db.query(sql, params);
        if (!result.values) return [];

        const candidates = result.values.map(row => ({
            ...row,
            embedding: this.blobToFloat32Array(row.embedding)
        }));

        // Compute Cosine Similarity
        const scored = candidates.map(c => {
            const sim = this.cosineSimilarity(queryVec, c.embedding);
            return {
                id: c.id,
                document_id: c.document_id,
                document_title: c.document_title,
                content: c.content,
                page_number: c.page_number,
                score: sim,
                distance: 1 - sim
            };
        });

        // Sort and limit
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private fuseResults(fts: RetrievalResult[], vec: RetrievalResult[]): RetrievalResult[] {
        const k = 60; // RRF constant
        const scores = new Map<number, number>();
        const nodeMap = new Map<number, RetrievalResult>();

        // Process FTS
        fts.forEach((item, rank) => {
            const s = 1 / (k + rank + 1);
            scores.set(item.id, (scores.get(item.id) || 0) + s);
            nodeMap.set(item.id, item);
        });

        // Process Vector
        vec.forEach((item, rank) => {
            const s = 1 / (k + rank + 1);
            scores.set(item.id, (scores.get(item.id) || 0) + s);
            if (!nodeMap.has(item.id)) nodeMap.set(item.id, item);
        });

        // Convert back to array
        return Array.from(scores.entries()).map(([id, score]) => {
            const item = nodeMap.get(id)!;
            return { ...item, score };
        });
    }

    private blobToFloat32Array(blob: any): Float32Array {
        if (!blob) return new Float32Array(384);
        if (blob instanceof Uint8Array) return new Float32Array(blob.buffer);
        if (typeof blob === 'string') {
            // Hex string
            const bytes = new Uint8Array(blob.length / 2);
            for (let i = 0; i < blob.length; i += 2) {
                bytes[i / 2] = parseInt(blob.substr(i, 2), 16);
            }
            return new Float32Array(bytes.buffer);
        }
        if (Array.isArray(blob)) return new Float32Array(new Uint8Array(blob).buffer);
        return new Float32Array(384);
    }

    private cosineSimilarity(a: Float32Array, b: Float32Array): number {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return (normA === 0 || normB === 0) ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Sanitizes a query for SQLite FTS5 MATCH clause.
     * Prevents syntax errors from special characters like !, *, -, ".
     */
    private sanitizeFtsQuery(query: string): string {
        if (!query) return "";

        // Remove double quotes and other potentially problematic characters
        // or just wrap the whole thing in quotes if it's not already complex.
        // For simplicity and safety, we'll strip special FTS5 operators 
        // and wrap the remaining words in a way that FTS5 likes.

        // 1. Remove characters that have special meaning in FTS5
        const clean = query.replace(/[:"^*\-+]/g, ' ').trim();

        if (!clean) return "";

        // 2. Wrap the search in double quotes to handle other symbols (like !)
        // but split into words to allow multiple terms
        const words = clean.split(/\s+/).filter(w => w.length > 0);

        // Return words wrapped in quotes and joined by AND (implicitly or explicitly)
        // This is the safest way to avoid fts5 syntax errors while still being effective.
        return words.map(w => `"${w}"`).join(' ');
    }
}
