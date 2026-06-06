/**
 * SemanticMemoryRetriever
 * 
 * Core class for semantic memory retrieval using vector embeddings.
 * Uses SQLite for storage and all-MiniLM-L6-v2 (or compatible) for embeddings.
 */

import { TextEmbedding } from 'text-embedding-capacitor';
import { saveMemoryToDb, getRecentMemories, getMemoryDatabase } from '../memory/memoryDatabase';
import { logger } from '../logger';

export interface RelevantMemory {
    content: string;
    similarity: number;
    role: string;
    timestamp: number;
}

export interface SemanticMemoryConfig {
    maxResults?: number;       // Max memories to return
    minSimilarity?: number;    // Min cosine similarity threshold
    maxTokens?: number;        // Max tokens in context injection
    maxAgeDays?: number;       // Max age of memories to consider
    sessionBoost?: number;     // Boost multiplier for current session
    queryPrefix?: string;      // Prefix for query embedding (e.g., 'query: ' for E5 models)
}

const DEFAULT_CONFIG: SemanticMemoryConfig = {
    maxResults: 3,
    minSimilarity: 0.75,
    maxTokens: 400,
    maxAgeDays: 30,
    sessionBoost: 1.2, // 20% boost for current session
    queryPrefix: '',   // Empty for MiniLM, 'query: ' for E5 models
};

class SemanticMemoryRetriever {
    private isModelLoaded = false;
    private dimension = 384;
    private config: SemanticMemoryConfig;

    constructor(config: Partial<SemanticMemoryConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize the embedding model
     * @param modelId ID of the model directory to load
     */
    async initialize(modelId: string): Promise<boolean> {
        logger.log('info', `[SemanticMemory] Starting initialization for model ID: "${modelId}"`);

        try {
            // Step 1: Validate model exists
            const { validateEmbeddingModel } = await import('../model/embeddingModelDownloader');
            const validation = await validateEmbeddingModel(modelId);

            if (!validation.exists) {
                logger.log('error', `[SemanticMemory] Model validation failed: ${validation.error}`);
                logger.log('error', `[SemanticMemory] Model path: ${validation.path}`);
                logger.log('error', `[SemanticMemory] Has model.onnx: ${validation.hasModel}, Has tokenizer.json: ${validation.hasTokenizer}`);
                this.isModelLoaded = false;
                return false;
            }

            logger.log('info', `[SemanticMemory] Model validation passed, loading from: ${validation.path}`);

            // Step 2: Load model into TextEmbedding plugin
            const startTime = performance.now();
            const result = await TextEmbedding.loadModel({ modelDir: validation.path });
            const loadTime = performance.now() - startTime;

            this.dimension = result.dimension;
            this.isModelLoaded = true;

            logger.log('info', `[SemanticMemory] ✓ Model loaded successfully in ${loadTime.toFixed(0)}ms`);
            logger.log('info', `[SemanticMemory] ✓ Embedding dimension: ${this.dimension}`);

            // Step 3: Ensure database is initialized
            await getMemoryDatabase();
            logger.log('info', `[SemanticMemory] ✓ Database initialized`);

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
            if (status.loaded) {
                this.dimension = status.dimension;
            }
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
    async saveMessage(sessionId: string, role: string, content: string): Promise<void> {
        if (!this.isModelLoaded) {
            logger.log('warn', '[SemanticMemory] Cannot save message - embedding model not loaded');
            return;
        }

        // Skip very short messages
        if (content.trim().length < 20) {
            logger.log('debug', '[SemanticMemory] Skipping short message (<20 chars)');
            return;
        }

        // Skip filler messages
        const fillerPatterns = /^(ok|okay|understood|got it|all right|sure|yes|no|thanks|thank you|you're welcome|good|perfect|great|capito|va bene|certo|sì|si|grazie|prego|ottimo)[\.\!\?]?$/i;
        if (fillerPatterns.test(content.trim())) {
            logger.log('debug', '[SemanticMemory] Skipping filler message');
            return;
        }

        const contentPreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
        logger.log('info', `[SemanticMemory] Checking ${role} message for duplicates: "${contentPreview}"`);

        const startTime = performance.now();

        try {
            // Generate embedding with a 10s timeout wrapper to prevent full app freezes
            const embeddingStart = performance.now();
            
            const embeddingPromise = TextEmbedding.generateEmbedding({ text: content });
            const timeoutPromise = new Promise<any>((_, reject) => 
                setTimeout(() => reject(new Error('TextEmbedding.generateEmbedding TIMEOUT')), 10000)
            );
            
            const result = await Promise.race([embeddingPromise, timeoutPromise]);
            
            const embedding = new Float32Array(result.embedding);
            const embeddingTime = performance.now() - embeddingStart;

            logger.log('debug', `[SemanticMemory] Generated ${embedding.length}-dim embedding in ${embeddingTime.toFixed(1)}ms`);

            // Deduplication check: compare with recent memories
            const recentMemories = await getRecentMemories(30); // Check last 30 entries
            const DUPLICATE_THRESHOLD = 0.90;

            for (const mem of recentMemories) {
                const similarity = this.cosineSimilarity(embedding, mem.embedding);
                if (similarity >= DUPLICATE_THRESHOLD) {
                    logger.log('info', `[SemanticMemory] ⏭️ Skipping duplicate (similarity: ${similarity.toFixed(3)}): "${mem.content.substring(0, 40)}..."`);
                    return; // Skip save
                }
            }

            // Generate unique ID
            const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Save to database
            const dbStart = performance.now();
            await saveMemoryToDb(id, sessionId, role, content, embedding);
            const dbTime = performance.now() - dbStart;

            const elapsed = performance.now() - startTime;
            logger.log('info', `[SemanticMemory] ✓ Saved to DB in ${dbTime.toFixed(1)}ms (total: ${elapsed.toFixed(1)}ms)`);
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
     * 1. Get top 50 recent memories
     * 2. Compute cosine similarity with query embedding
     * 3. Filter by minSimilarity, boost current session
     * 4. Return top N results
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
        if (!this.isModelLoaded) {
            logger.log('warn', '[SemanticMemory] Model not loaded, using recency fallback');
            return this.getRecentMemoriesFallback(maxResults);
        }

        try {
            // Generate query embedding with optional prefix (for E5/BGE models)
            const queryText = this.config.queryPrefix ? this.config.queryPrefix + query : query;
            logger.log('info', `[SemanticMemory] Generating embedding for query: "${queryPreview}"`);
            
            const embeddingPromise = TextEmbedding.generateEmbedding({ text: queryText });
            const timeoutPromise = new Promise<any>((_, reject) => 
                setTimeout(() => reject(new Error('TextEmbedding.generateEmbedding TIMEOUT')), 10000)
            );
            const queryResult = await Promise.race([embeddingPromise, timeoutPromise]);
            
            logger.log('info', `[SemanticMemory] Embedding generation complete.`);
            const queryEmbedding = new Float32Array(queryResult.embedding);

            // Get recent memories from database
            const memories = await getRecentMemories(50, undefined, this.config.maxAgeDays);
            logger.log('debug', `[SemanticMemory] Retrieved ${memories.length} recent memories from DB`);

            if (memories.length === 0) {
                logger.log('warn', '[SemanticMemory] No memories in database');
                return [];
            }

            // Compute similarities
            const scored = memories.map(memory => {
                let similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);

                // Boost current session matches
                if (sessionId && memory.sessionId === sessionId) {
                    similarity *= this.config.sessionBoost!;
                }

                return {
                    content: memory.content,
                    similarity,
                    role: memory.role,
                    timestamp: memory.timestamp,
                };
            });

            // Filter by minimum similarity
            const filtered = scored.filter(m => m.similarity >= minSimilarity);

            // If no semantic matches, fallback to recent
            if (filtered.length === 0) {
                logger.log('debug', `[SemanticMemory] No matches above similarity threshold ${minSimilarity}, using recency fallback`);
                const topRecent = scored
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, maxResults);
                logger.log('info', `[SemanticMemory] ✓ Returning ${topRecent.length} recent memories as fallback`);
                return topRecent;
            }

            // Sort by similarity and take top N
            let results = filtered
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, maxResults);

            // Enrich with graph-related memories (if graph is available)
            try {
                const { getMemoryGraphService } = await import('../memory/memoryGraph');
                const graphService = getMemoryGraphService();

                if (results.length > 0) {
                    // Find memories related via graph to the top result
                    const topMemoryId = results[0].content.substring(0, 50); // Use content hash as ID proxy
                    const graphRelated = await graphService.findRelatedMemories(topMemoryId, 2);

                    // Add graph-related memories that aren't already in results
                    const existingContent = new Set(results.map(r => r.content));
                    for (const related of graphRelated) {
                        if (!existingContent.has(related.memory.content) && results.length < maxResults + 2) {
                            results.push({
                                content: related.memory.content,
                                similarity: related.score * 0.9, // Slightly lower score for graph-based
                                role: 'memory', // Graph nodes don't have role, default to 'memory'
                                timestamp: related.memory.timestamp,
                            });
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
            return this.getRecentMemoriesFallback(maxResults);
        }
    }

    /**
     * Cosine similarity between two 384-dim vectors
     * Pure numerical implementation, no libraries
     */
    private cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
        if (vec1.length !== vec2.length) {
            logger.log('warn', `Dimension mismatch: ${vec1.length} vs ${vec2.length}`);
            return 0;
        }

        let dot = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vec1.length; i++) {
            dot += vec1[i] * vec2[i];
            normA += vec1[i] * vec1[i];
            normB += vec2[i] * vec2[i];
        }

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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
    private async getRecentMemoriesFallback(limit: number): Promise<RelevantMemory[]> {
        try {
            const memories = await getRecentMemories(limit);
            return memories.map(m => ({
                content: m.content,
                similarity: 0,
                role: m.role,
                timestamp: m.timestamp,
            }));
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
            await TextEmbedding.unloadModel();
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

    // Check current status
    const status = await retriever.checkModelStatus();
    if (!status.loaded) {
        // Attempt to initialize
        logger.log('info', `Auto-initializing semantic memory with model: ${config.embeddingModelId}`);
        const initialized = await retriever.initialize(config.embeddingModelId);
        if (!initialized) {
            logger.log('warn', 'Failed to auto-initialize semantic memory retriever');
            return null;
        }
    }

    return retriever;
}

export { SemanticMemoryRetriever };
