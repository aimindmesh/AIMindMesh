/**
 * Memory Graph Service
 * Provides graph-based memory retrieval with entity relationships.
 * Builds on the semantic memory system to enable connected knowledge.
 */

import { logger } from '../logger';
import { stems } from './context/memoryContext';
import { initMemoryDatabase, getMemoryDatabase } from '../memory/memoryDatabase';
import { blobToFloat32Array, cosineSimilarity } from './embeddingCodec';

/**
 * Memory relation type
 */
export type RelationType =
    | 'related_to'      // General association
    | 'follows'         // Temporal sequence
    | 'causes'          // Causal relationship
    | 'part_of'         // Hierarchical
    | 'similar_to'      // Semantic similarity
    | 'mentioned_with'  // Co-occurrence
    | 'responds_to';    // Conversational link

/**
 * Memory relation between two memories
 */
export interface MemoryRelation {
    id: string;
    sourceMemoryId: string;
    targetMemoryId: string;
    relationType: RelationType;
    weight: number;  // 0-1, strength of relation
    createdAt: number;
    metadata?: Record<string, unknown>;
}

/**
 * Memory node for graph traversal
 */
export interface MemoryNode {
    id: string;
    content: string;
    embedding?: number[];
    sessionId: string;
    timestamp: number;
    category?: string;
    relations: {
        outgoing: MemoryRelation[];
        incoming: MemoryRelation[];
    };
}

/**
 * Graph traversal result
 */
export interface GraphTraversalResult {
    nodes: MemoryNode[];
    edges: MemoryRelation[];
    depth: number;
}

// Schema for memory relations table
const RELATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_relations (
    id TEXT PRIMARY KEY,
    source_memory_id TEXT NOT NULL,
    target_memory_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    metadata TEXT,
    FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON memory_relations(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON memory_relations(target_memory_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
`;

/**
 * Memory Graph Service
 */
export class MemoryGraphService {
    private isInitialized = false;

    /**
     * Initialize the memory graph (create relations table)
     */
    public async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            await initMemoryDatabase();
            const db = await getMemoryDatabase();

            if (!db) {
                throw new Error('Failed to get database connection');
            }

            // Create relations table
            const statements = RELATIONS_SCHEMA.split(';').filter(s => s.trim());
            for (const stmt of statements) {
                if (stmt.trim()) {
                    await db.execute(stmt).catch(() => {
                        // Table might already exist
                    });
                }
            }

            this.isInitialized = true;
            logger.log('info', 'Memory graph initialized');
        } catch (error) {
            logger.log('error', 'Failed to initialize memory graph', error);
            throw error;
        }
    }

    /**
     * Add a relation between two memories
     */
    public async addRelation(
        sourceId: string,
        targetId: string,
        relationType: RelationType,
        weight: number = 1.0,
        metadata?: Record<string, unknown>
    ): Promise<string> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) throw new Error('Database not connected');

        const id = `rel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = Date.now();
        const metadataJson = metadata ? JSON.stringify(metadata) : null;

        await db.run(
            `INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, weight, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, sourceId, targetId, relationType, weight, createdAt, metadataJson]
        );

        logger.log('debug', `Added relation: ${sourceId} --[${relationType}]--> ${targetId}`);
        return id;
    }

    /**
     * Get relations for a memory
     */
    public async getRelations(memoryId: string): Promise<{ outgoing: MemoryRelation[]; incoming: MemoryRelation[] }> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) throw new Error('Database not connected');

        const outgoingResult = await db.query(
            `SELECT * FROM memory_relations WHERE source_memory_id = ?`,
            [memoryId]
        );

        const incomingResult = await db.query(
            `SELECT * FROM memory_relations WHERE target_memory_id = ?`,
            [memoryId]
        );

        const parseRelation = (row: any): MemoryRelation => ({
            id: row.id,
            sourceMemoryId: row.source_memory_id,
            targetMemoryId: row.target_memory_id,
            relationType: row.relation_type as RelationType,
            weight: row.weight,
            createdAt: row.created_at,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });

        return {
            outgoing: (outgoingResult.values ?? []).map(parseRelation),
            incoming: (incomingResult.values ?? []).map(parseRelation),
        };
    }

    /**
     * Traverse the memory graph starting from a node
     */
    public async traverseGraph(
        startMemoryId: string,
        options: {
            maxDepth?: number;
            relationTypes?: RelationType[];
            minWeight?: number;
            maxNodes?: number;
        } = {}
    ): Promise<GraphTraversalResult> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) throw new Error('Database not connected');

        const {
            maxDepth = 2,
            relationTypes,
            minWeight = 0.3,
            maxNodes = 50
        } = options;

        const visitedNodes = new Set<string>();
        const nodes: MemoryNode[] = [];
        const edges: MemoryRelation[] = [];
        const queue: { id: string; depth: number }[] = [{ id: startMemoryId, depth: 0 }];

        while (queue.length > 0 && nodes.length < maxNodes) {
            const { id, depth } = queue.shift()!;

            if (visitedNodes.has(id) || depth > maxDepth) continue;
            visitedNodes.add(id);

            // Get memory content
            const memoryResult = await db.query(
                `SELECT id, content, session_id, timestamp, category FROM memories WHERE id = ?`,
                [id]
            );

            if (!memoryResult.values || memoryResult.values.length === 0) continue;

            const memoryRow = memoryResult.values[0];
            const relations = await this.getRelations(id);

            nodes.push({
                id: memoryRow.id,
                content: memoryRow.content,
                sessionId: memoryRow.session_id,
                timestamp: memoryRow.timestamp,
                category: memoryRow.category,
                relations,
            });

            // Add outgoing edges and queue connected nodes
            for (const rel of relations.outgoing) {
                if (rel.weight < minWeight) continue;
                if (relationTypes && !relationTypes.includes(rel.relationType)) continue;

                edges.push(rel);

                if (!visitedNodes.has(rel.targetMemoryId) && depth < maxDepth) {
                    queue.push({ id: rel.targetMemoryId, depth: depth + 1 });
                }
            }

            // Also consider incoming edges for bidirectional traversal
            for (const rel of relations.incoming) {
                if (rel.weight < minWeight) continue;
                if (relationTypes && !relationTypes.includes(rel.relationType)) continue;

                if (!edges.find(e => e.id === rel.id)) {
                    edges.push(rel);
                }

                if (!visitedNodes.has(rel.sourceMemoryId) && depth < maxDepth) {
                    queue.push({ id: rel.sourceMemoryId, depth: depth + 1 });
                }
            }
        }

        logger.log('debug', `Graph traversal: ${nodes.length} nodes, ${edges.length} edges`);

        return { nodes, edges, depth: maxDepth };
    }

    /**
     * Find related memories using graph + embedding similarity
     */
    public async findRelatedMemories(
        memoryId: string,
        limit: number = 10
    ): Promise<Array<{ memory: MemoryNode; score: number; path: string[] }>> {
        await this.initialize();

        // Get direct graph connections
        const graph = await this.traverseGraph(memoryId, {
            maxDepth: 2,
            maxNodes: limit * 3
        });

        // Score nodes based on distance and relation weight
        const scored = graph.nodes
            .filter(n => n.id !== memoryId)
            .map(node => {
                // Calculate path from start
                const path = this.findPath(memoryId, node.id, graph.edges);

                // Score based on path length and relation weights
                let score = 1.0;
                for (let i = 0; i < path.length - 1; i++) {
                    const edge = graph.edges.find(
                        e => (e.sourceMemoryId === path[i] && e.targetMemoryId === path[i + 1]) ||
                            (e.targetMemoryId === path[i] && e.sourceMemoryId === path[i + 1])
                    );
                    if (edge) {
                        score *= edge.weight;
                    }
                }

                // Decay by distance
                score *= Math.pow(0.7, path.length - 1);

                return { memory: node, score, path };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return scored;
    }

    /**
     * Find shortest path between two nodes
     */
    private findPath(fromId: string, toId: string, edges: MemoryRelation[]): string[] {
        const visited = new Set<string>();
        const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];

        while (queue.length > 0) {
            const { id, path } = queue.shift()!;

            if (id === toId) return path;
            if (visited.has(id)) continue;
            visited.add(id);

            // Find connected nodes
            for (const edge of edges) {
                let nextId: string | null = null;
                if (edge.sourceMemoryId === id) nextId = edge.targetMemoryId;
                if (edge.targetMemoryId === id) nextId = edge.sourceMemoryId;

                if (nextId && !visited.has(nextId)) {
                    queue.push({ id: nextId, path: [...path, nextId] });
                }
            }
        }

        return [fromId]; // No path found
    }

    /**
     * Auto-detect relations of a newly saved memory (called by SemanticMemoryRetriever.saveMessage):
     * the previous memory of the same conversation (follows), recent memories embedded by the
     * same model with similar vectors (similar_to), shared keywords (mentioned_with).
     */
    public async detectRelations(
        memoryId: string,
        content: string,
        embedding: ArrayLike<number>,
        sessionId: string,
        modelKey: string | null
    ): Promise<MemoryRelation[]> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) throw new Error('Database not connected');

        const relations: MemoryRelation[] = [];
        const link = async (sourceId: string, targetId: string, type: RelationType, weight: number, metadata?: Record<string, unknown>) => {
            try {
                const id = await this.addRelation(sourceId, targetId, type, weight, metadata);
                relations.push({ id, sourceMemoryId: sourceId, targetMemoryId: targetId, relationType: type, weight, createdAt: Date.now(), metadata });
            } catch (e) {
                // e.g. the other memory was deleted meanwhile (foreign key)
                logger.log('debug', `Relation ${type} ${sourceId} -> ${targetId} skipped`, e);
            }
        };

        // Earlier memories of the same conversation, newest first
        const sessionResult = await db.query(
            `SELECT id, content FROM memories WHERE session_id = ? AND id != ? ORDER BY timestamp DESC LIMIT 5`,
            [sessionId, memoryId]
        );
        const sessionRecent = sessionResult.values ?? [];

        // 1. Temporal relation with previous message (follows)
        if (sessionRecent.length > 0) {
            await link(sessionRecent[0].id, memoryId, 'follows', 0.8);
        }

        // 2. Similar content: vectors of other models are not comparable
        if (modelKey) {
            const recentResult = await db.query(
                `SELECT id, hex(embedding) AS embedding FROM memories
                 WHERE id != ? AND embedding_model = ?
                 ORDER BY timestamp DESC
                 LIMIT 20`,
                [memoryId, modelKey]
            );
            for (const row of recentResult.values ?? []) {
                const similarity = cosineSimilarity(embedding, blobToFloat32Array(row.embedding));
                if (similarity >= 0.75) {
                    await link(memoryId, row.id, 'similar_to', similarity);
                }
            }
        }

        // 3. Topic co-occurrence (mentioned_with) - simple keyword detection
        const keywords = this.extractKeywords(content);
        for (const other of sessionRecent) {
            const otherKeywords = this.extractKeywords(String(other.content ?? ''));
            const overlap = keywords.filter(k => otherKeywords.includes(k));
            if (overlap.length >= 2) {
                await link(memoryId, other.id, 'mentioned_with', Math.min(overlap.length / 5, 1.0), { sharedKeywords: overlap });
            }
        }

        logger.log('debug', `Detected ${relations.length} relations for memory ${memoryId}`);
        return relations;
    }

    /**
     * Keyword stems shared by two memories: Unicode words (accented Italian included), Italian
     * and English stopwords removed (same stems as the fact matching of memoryContext)
     */
    private extractKeywords(text: string): string[] {
        return [...stems(text)].slice(0, 20);
    }

    /**
     * Delete all relations for a memory
     */
    public async deleteRelationsForMemory(memoryId: string): Promise<void> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) return;

        await db.run(
            `DELETE FROM memory_relations WHERE source_memory_id = ? OR target_memory_id = ?`,
            [memoryId, memoryId]
        );
    }

    /**
     * Get graph statistics
     */
    public async getStats(): Promise<{ totalRelations: number; relationTypeCounts: Record<string, number> }> {
        await this.initialize();
        const db = await getMemoryDatabase();

        if (!db) return { totalRelations: 0, relationTypeCounts: {} };

        const totalResult = await db.query(`SELECT COUNT(*) as count FROM memory_relations`);
        const totalRelations = totalResult.values?.[0]?.count ?? 0;

        const typeResult = await db.query(
            `SELECT relation_type, COUNT(*) as count FROM memory_relations GROUP BY relation_type`
        );

        const relationTypeCounts: Record<string, number> = {};
        for (const row of typeResult.values ?? []) {
            relationTypeCounts[row.relation_type] = row.count;
        }

        return { totalRelations, relationTypeCounts };
    }
}

// Singleton
let _graphService: MemoryGraphService | null = null;

export function getMemoryGraphService(): MemoryGraphService {
    if (!_graphService) {
        _graphService = new MemoryGraphService();
    }
    return _graphService;
}
