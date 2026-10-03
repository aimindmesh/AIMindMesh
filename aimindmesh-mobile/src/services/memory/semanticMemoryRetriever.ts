/**
 * SemanticMemoryRetriever
 * 
 * Core class for semantic memory retrieval using vector embeddings.
 * Uses SQLite for storage and all-MiniLM-L6-v2 (or compatible) for embeddings.
 * Model loading, prefixes and the model tag of each vector are handled by embeddingRuntime.
 */

import { TextEmbedding } from 'text-embedding-capacitor';
import { saveMemoryToDb, getRecentMemories, getMemoryDatabase, getMemoryEmbeddings, getMemoriesByIds, pruneOldMemories } from '../memory/memoryDatabase';
import { cosineSimilarity } from './embeddingCodec';
import { isSelfMatch, withoutSelfMatches } from './selfMatch';
import { embedText, ensureEmbeddingModel, getActiveEmbeddingModel, getEmbeddingLoadError, unloadEmbeddingModel } from '../model/embedding/embeddingRuntime';
import { logger } from '../logger';

export interface RelevantMemory {
    content: string;
    similarity: number;
    role: string;
    timestamp: number;
    id?: string;
}

/** Spare candidates scored beyond maxResults, to replace self matches dropped afterwards */
const SELF_MATCH_SPARE = 3;
let pruneScheduled = false;

export interface SemanticMemoryConfig {
    maxResults?: number;       // Max memories to return
    minSimilarity?: number;    // Min cosine similarity threshold
    maxTokens?: number;        // Max tokens in context injection
    maxAgeDays?: number;       // Max age of chat turns to consider (facts and summaries never age out)
    sessionBoost?: number;     // Boost multiplier for current session
    queryPrefix?: string;      // Unused: the runtime applies each model's own prefixes
}

const DEFAULT_CONFIG: SemanticMemoryConfig = {
    maxResults: 3,
    minSimilarity: 0.60, // Lowered from 0.75 to allow cross-language matching (e.g. English model vs Italian query)
    maxTokens: 400,
    maxAgeDays: 30,
    sessionBoost: 1.2, // 20% boost for current session
    queryPrefix: '',   // Unused: embeddingRuntime adds 'query: ' for E5 models
};

class SemanticMemoryRetriever {
    private isModelLoaded = false;
    private config: SemanticMemoryConfig;

    constructor(config: Partial<SemanticMemoryConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Make `modelId` the loaded embedding model (reloads when another model is loaded, cheap
     * when it already is). Called before every use, so a model change in the settings takes
     * effect on the next message.
     * @param modelId ID of the model directory to load
     */
    async initialize(modelId: string): Promise<boolean> {
        try {
            const loaded = await ensureEmbeddingModel(modelId);
            const model = getActiveEmbeddingModel();
            this.isModelLoaded = loaded && model?.modelId === modelId;
            if (!this.isModelLoaded || !model) {
                logger.log('error', `[SemanticMemory] Model "${modelId}" not available: ${getEmbeddingLoadError(modelId) || 'unknown error'}`);
                return false;
            }
            // Ensure database is initialized
            await getMemoryDatabase();
            if (!pruneScheduled) {
                pruneScheduled = true;
                // Chat turns past the retention period are outside the retrieval window anyway
                pruneOldMemories().catch(e => logger.log('warn', '[SemanticMemory] Prune failed', e));
            }
            return true;
        } catch (error) {
            logger.log('error', `[SemanticMemory] ✗ Failed to initialize: ${(error as any).message}`, error);
            this.isModelLoaded = false;
            return false;
        }
    }

    /**
     * Check if model is loaded
     */
    async checkModelStatus(): Promise<{ loaded: boolean; dimension: number }> {
        try {
            const status = await TextEmbedding.isModelLoaded();
            this.isModelLoaded = status.loaded;
            return { loaded: status.loaded, dimension: status.dimension };
        } catch {
            return { loaded: false, dimension: 0 };
        }
    }

    /**
     * Save a message with its embedding to the database
     * Target: <50ms on Z Fold 7
     * 
     * Optimization: Skips save if:
     * - Content is too short (<20 chars)
     * - Content is filler (OK, Capito, etc.)
     * - Semantically similar memory already exists (similarity > 0.90)
     */
    async saveMessage(sessionId: string, role: string, content: string): Promise<string | null> {
        if (!this.isModelLoaded || !getActiveEmbeddingModel()) {
            logger.log('warn', '[SemanticMemory] Cannot save message - embedding model not loaded');
            return null;
        }

        // Skip very short messages
        if (content.trim().length < 20) {
            logger.log('debug', '[SemanticMemory] Skipping short message (<20 chars)');
            return null;
        }

        // Skip filler messages
        const fillerPatterns = /^(ok|okay|understood|got it|all right|sure|yes|no|thanks|thank you|you're welcome|good|perfect|great|capito|va bene|certo|sì|si|grazie|prego|ottimo)[\.\!\?]?$/i;
        if (fillerPatterns.test(content.trim())) {
            logger.log('debug', '[SemanticMemory] Skipping filler message');
            return null;
        }

        const contentPreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
        logger.log('info', `[SemanticMemory] Checking ${role} message for duplicates: "${contentPreview}"`);

        const startTime = performance.now();

        try {
            // Embedding with the model's passage prefix, tagged with the model key
            const { vector: embedding, key } = await embedText(content, 'passage');

            // Deduplication check: compare with recent memories of the same model
            const recentMemories = await getRecentMemories(30, undefined, 30, key); // Check last 30 entries
            const DUPLICATE_THRESHOLD = 0.90;

            for (const mem of recentMemories) {
                const similarity = cosineSimilarity(embedding, mem.embedding);
                if (similarity >= DUPLICATE_THRESHOLD) {
                    logger.log('info', `[SemanticMemory] ⏭️ Skipping duplicate (similarity: ${similarity.toFixed(3)}): "${mem.content.substring(0, 40)}..."`);
                    return null; // Skip save
                }
            }

            // Generate unique ID
            const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            await saveMemoryToDb(id, sessionId, role, content, embedding, key);

            const elapsed = performance.now() - startTime;
            logger.log('info', `[SemanticMemory] ✓ Saved to DB (total: ${elapsed.toFixed(1)}ms)`);

            // Link it in the memory graph (follows / similar_to / mentioned_with), off the reply path
            import('./memoryGraph')
                .then(({ getMemoryGraphService }) => getMemoryGraphService().detectRelations(id, content, embedding, sessionId, key))
                .catch(e => logger.log('debug', '[SemanticMemory] Graph linking skipped', e));
            return id;
        } catch (error) {
            logger.log('error', '[SemanticMemory] ✗ Failed to save message', error);
            throw error;
        }
    }

    /**
     * Retrieve semantically relevant memories for a query
     * Target: <200ms on Z Fold 7
     * 
     * Strategy:
     * 1. Score EVERY memory in the age window (ids + embeddings only, read in pages)
     * 2. Compute cosine similarity with query embedding, boost current session
     * 3. Filter by minSimilarity, keep the top N
     * 4. Load the text of those N only
     */
    async retrieveRelevantMemories(
        query: string,
        sessionId?: string,
        maxResults: number = this.config.maxResults!,
        minSimilarity: number = this.config.minSimilarity!
    ): Promise<RelevantMemory[]> {
        const queryPreview = query.length > 60 ? query.substring(0, 60) + '...' : query;
        logger.log('info', `[SemanticMemory] Retrieving memories for query: "${queryPreview}"`);

        const startTime = performance.now();

        // Handle empty query - return most recent memories
        if (!query.trim()) {
            logger.log('warn', '[SemanticMemory] Empty query, using recency fallback');
            return this.getRecentMemoriesFallback(maxResults);
        }

        // Check if model is loaded
        if (!this.isModelLoaded || !getActiveEmbeddingModel()) {
            logger.log('warn', '[SemanticMemory] Model not loaded, using recency fallback');
            return this.getRecentMemoriesFallback(maxResults, query);
        }

        try {
            // Query embedding with the model's query prefix (E5)
            const { vector: queryEmbedding, key } = await embedText(query, 'query');

            // Score every usable memory of the same model (other models' vectors are not comparable)
            const vectors = await getMemoryEmbeddings(this.config.maxAgeDays!, key);
            logger.log('debug', `[SemanticMemory] Scoring ${vectors.length} memories`);

            if (vectors.length === 0) {
                logger.log('warn', '[SemanticMemory] No memories in database');
                return [];
            }

            const candidates = vectors
                .map(v => {
                    let similarity = cosineSimilarity(queryEmbedding, v.embedding);
                    // Boost current session matches
                    if (sessionId && v.sessionId === sessionId) similarity *= this.config.sessionBoost!;
                    return { id: v.id, similarity };
                })
                .filter(m => m.similarity >= minSimilarity)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, maxResults + SELF_MATCH_SPARE);

            // If no semantic matches, return empty. Do NOT fallback to recency because the LLM already 
            // has the recent history natively. Returning recent history here pollutes the factual context block.
            if (candidates.length === 0) {
                logger.log('debug', `[SemanticMemory] No matches above similarity threshold ${minSimilarity}`);
                return [];
            }

            const rows = new Map((await getMemoriesByIds(candidates.map(m => m.id))).map(r => [r.id, r]));
            // The message being answered was saved just before this call: it is not a memory
            let results: RelevantMemory[] = withoutSelfMatches(candidates.flatMap(m => {
                const row = rows.get(m.id);
                return row ? [{ id: m.id, content: row.content, similarity: m.similarity, role: row.role, timestamp: row.timestamp }] : [];
            }), query, maxResults);

            // Enrich with graph-related memories (if graph is available)
            try {
                const { getMemoryGraphService } = await import('../memory/memoryGraph');
                const graphService = getMemoryGraphService();

                if (results.length > 0 && results[0].id) {
                    // Find memories related via graph to the top result (by its real id)
                    const graphRelated = await graphService.findRelatedMemories(results[0].id, 2);

                    // Add graph-related memories that aren't already in results
                    const existingContent = new Set(results.map(r => r.content));
                    for (const related of graphRelated) {
                        if (existingContent.has(related.memory.content) || isSelfMatch(related.memory.content, query)) continue;
                        if (results.length < maxResults + 2) {
                            results.push({
                                id: related.memory.id,
                                content: related.memory.content,
                                similarity: related.score * 0.9, // Slightly lower score for graph-based
                                role: 'memory', // Graph nodes don't have role, default to 'memory'
                                timestamp: related.memory.timestamp,
                            });
                            existingContent.add(related.memory.content);
                            logger.log('debug', `[SemanticMemory] Added graph-related memory: "${related.memory.content.substring(0, 30)}..."`);
                        }
                    }
                }
            } catch (graphError) {
                // Graph service not available, continue without enrichment
                logger.log('debug', '[SemanticMemory] Memory graph not available, skipping enrichment');
            }

            const elapsed = performance.now() - startTime;
            const topSimilarity = results[0]?.similarity.toFixed(3);
            logger.log('info', `[SemanticMemory] ✓ Found ${results.length} relevant memories in ${elapsed.toFixed(1)}ms (top similarity: ${topSimilarity})`);

            // Log top matches for debugging
            results.forEach((m, i) => {
                const preview = m.content.substring(0, 40);
                logger.log('debug', `  [${i + 1}] ${m.role} (${m.similarity.toFixed(3)}): "${preview}..."`);
            });

            return results;
        } catch (error) {
            logger.log('error', '[SemanticMemory] ✗ Failed to retrieve memories', error);
            return this.getRecentMemoriesFallback(maxResults, query);
        }
    }

    /**
     * Truncate results to fit within token limit
     * Simple estimation: 1 token ≈ 4 characters
     */
    truncateToTokenLimit(memories: RelevantMemory[], maxTokens: number = this.config.maxTokens!): RelevantMemory[] {
        const CHARS_PER_TOKEN = 4;
        const maxChars = maxTokens * CHARS_PER_TOKEN;

        let totalChars = 0;
        const truncated: RelevantMemory[] = [];

        for (const memory of memories) {
            const memoryChars = memory.content.length + 20; // Extra for formatting

            if (totalChars + memoryChars <= maxChars) {
                truncated.push(memory);
                totalChars += memoryChars;
            } else {
                // Try to include a truncated version
                const remaining = maxChars - totalChars - 20;
                if (remaining > 50) {
                    truncated.push({
                        ...memory,
                        content: memory.content.slice(0, remaining) + '...',
                    });
                }
                break;
            }
        }

        return truncated;
    }

    /**
     * Fallback: get most recent memories without semantic matching
     */
    private async getRecentMemoriesFallback(limit: number, query: string = ''): Promise<RelevantMemory[]> {
        try {
            const memories = await getRecentMemories(limit + 1);
            return withoutSelfMatches(memories.map(m => ({
                id: m.id,
                content: m.content,
                similarity: 0,
                role: m.role,
                timestamp: m.timestamp,
            })), query, limit);
        } catch (error) {
            logger.log('error', 'Failed to get recent memories fallback', error);
            return [];
        }
    }

    /**
     * Format memories for LLM context injection
     */
    formatForContext(memories: RelevantMemory[]): string {
        if (memories.length === 0) {
            return '';
        }

        const lines = memories.map((m, i) =>
            `[Memory ${i + 1}] ${m.role}: ${m.content}`
        );

        return `--- Relevant Memories ---\n${lines.join('\n')}\n--- End Memories ---`;
    }

    /**
     * Unload the model to free resources
     */
    async unload(): Promise<void> {
        try {
            await unloadEmbeddingModel();
            this.isModelLoaded = false;
            logger.log('info', 'Embedding model unloaded');
        } catch (error) {
            logger.log('error', 'Failed to unload embedding model', error);
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<SemanticMemoryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): SemanticMemoryConfig {
        return { ...this.config };
    }
}

// Singleton instance
let retrieverInstance: SemanticMemoryRetriever | null = null;

/**
 * Get the singleton SemanticMemoryRetriever instance
 */
export function getSemanticMemoryRetriever(config?: Partial<SemanticMemoryConfig>): SemanticMemoryRetriever {
    if (!retrieverInstance) {
        retrieverInstance = new SemanticMemoryRetriever(config);
    } else if (config) {
        retrieverInstance.updateConfig(config);
    }
    return retrieverInstance;
}

/**
 * Get or initialize the semantic memory retriever with auto-initialization
 * Auto-loads the model based on LLMConfig if enabled
 * @returns SemanticMemoryRetriever if successfully initialized, null otherwise
 */
export async function getOrInitializeSemanticMemoryRetriever(
    config: {
        enableSemanticMemory?: boolean;
        embeddingModelId?: string;
        semanticMemoryMaxResults?: number;
        semanticMemorySimilarityThreshold?: number;
    }
): Promise<SemanticMemoryRetriever | null> {
    // Check if enabled and model is specified
    if (!config.enableSemanticMemory || !config.embeddingModelId) {
        return null;
    }

    const retriever = getSemanticMemoryRetriever({
        maxResults: config.semanticMemoryMaxResults || 3,
        minSimilarity: config.semanticMemorySimilarityThreshold || 0.75,
    });

    // Loads the selected model, or switches to it when another one is loaded
    const initialized = await retriever.initialize(config.embeddingModelId);
    if (!initialized) {
        logger.log('warn', 'Failed to auto-initialize semantic memory retriever');
        return null;
    }

    return retriever;
}

export { SemanticMemoryRetriever };
