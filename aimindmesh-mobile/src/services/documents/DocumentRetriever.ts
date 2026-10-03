import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { logger } from '../logger';
import { workspaceService } from '../workspaces/WorkspaceService';
import { embedText, ensureEmbeddingModelFromSettings, getActiveEmbeddingModel } from '../model/embedding/embeddingRuntime';
import { blobToFloat32Array, cosineSimilarity } from '../memory/embeddingCodec';

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

        // 2. Vector Search (Semantic): only chunks embedded by the same model are comparable
        let vecResults: RetrievalResult[] = [];
        try {
            if (!getActiveEmbeddingModel() && !(await ensureEmbeddingModelFromSettings())) {
                throw new Error('No embedding model loaded');
            }
            const { vector: queryVec, key } = await embedText(query, 'query');
            vecResults = await this.vectorSearch(queryVec, key, workspaceId, topK * 2);
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
        // The saved mode and active workspace are loaded lazily (the default would be GLOBAL)
        await workspaceService.ensureInitialized();
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
            const fts = await this.keywordSearch(query, activeWorkspace.id, activeWorkspace.settings.max_chunks || 5);
            return fts.map(r => ({ ...r, score: 1 }));
        }

        return this.hybridSearchInWorkspace(
            query,
            activeWorkspace.id,
            activeWorkspace.settings.max_chunks || 5
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
      WHERE document_chunks_fts MATCH ? AND d.total_chunks > 0
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

    private async vectorSearch(queryVec: Float32Array, modelKey: string, workspaceId: number | null, limit: number): Promise<RetrievalResult[]> {
        const db = await getKnowledgeDatabase();
        const PAGE = 500;

        // Brute force in JS (fine for <10k chunks), but only ids and embeddings (as compact hex)
        // travel over the bridge, in pages: the text is loaded for the best `limit` chunks only.
        // Chunks of another model wait for re-embedding (embeddingReindexer).
        let sql = `SELECT dc.id, hex(dc.embedding) AS embedding FROM document_chunks dc WHERE dc.embedding_model = ?`;
        const params: any[] = [modelKey];
        if (workspaceId) {
            sql += ` AND dc.document_id IN (SELECT document_id FROM workspace_documents WHERE workspace_id = ?)`;
            params.push(workspaceId);
        }
        sql += ` ORDER BY dc.id LIMIT ? OFFSET ?`;

        let best: { id: number; score: number }[] = [];
        for (let offset = 0; ; offset += PAGE) {
            const page = (await db.query(sql, [...params, PAGE, offset])).values || [];
            for (const row of page) {
                best.push({ id: row.id, score: cosineSimilarity(queryVec, blobToFloat32Array(row.embedding)) });
            }
            best = best.sort((x, y) => y.score - x.score).slice(0, limit);
            if (page.length < PAGE) break;
        }
        if (best.length === 0) return [];

        const details = await db.query(`
      SELECT dc.id, dc.content, dc.document_id, d.title as document_title, dc.page_number
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE dc.id IN (${best.map(() => '?').join(',')}) AND d.total_chunks > 0
    `, best.map(b => b.id));
        const rows = new Map((details.values || []).map(row => [row.id, row]));

        return best.flatMap(({ id, score }) => {
            const row = rows.get(id);
            return row ? [{
                id,
                document_id: row.document_id,
                document_title: row.document_title,
                content: row.content,
                page_number: row.page_number,
                score,
                distance: 1 - score
            }] : [];
        });
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

        // Quoted words joined by OR: an implicit AND required every word of a natural-language
        // question to appear in the same chunk, so almost nothing matched. bm25 `rank` still puts
        // the chunks matching more (and rarer) words first.
        return words.slice(0, 16).map(w => `"${w}"`).join(' OR ');
    }
}
