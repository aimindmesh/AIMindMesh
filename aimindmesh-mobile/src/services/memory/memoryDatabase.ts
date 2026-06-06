/**
 * Memory Database Service
 * SQLite-backed storage for semantic memory retrieval
 * Refactored to use Centralized DatabaseManager
 */

import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../logger';
import { DatabaseManager } from '../database/DatabaseManager';

// Schema with category support
const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  category TEXT DEFAULT 'semantic',
  is_synced INTEGER DEFAULT 0,
  server_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_time ON memories(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp DESC);
`;

// Migration to add category column
const MIGRATION_V2 = `
ALTER TABLE memories ADD COLUMN category TEXT DEFAULT 'semantic';
CREATE INDEX IF NOT EXISTS idx_category ON memories(category);
`;

let isSchemaApplied = false;

/**
 * Initialize the SQLite connection and database schemas
 */
export async function initMemoryDatabase(): Promise<SQLiteDBConnection> {
    const db = await DatabaseManager.getInstance().getDatabase('memory');

    if (isSchemaApplied) {
        return db;
    }

    try {
        // Create schema as a single execution block
        await db.execute(SCHEMA);
        logger.log('info', 'Memory database schema created');

        // Apply migration v2 - add category column if missing
        try {
            // Check if column exists first to avoid native error logs
            const tableInfo = await db.query("PRAGMA table_info(memories);");
            const hasCategory = tableInfo.values?.some((col: any) => col.name === 'category');

            if (!hasCategory) {
                const migrationStatements = MIGRATION_V2.split(';').filter(s => s.trim());
                for (const stmt of migrationStatements) {
                    if (stmt.trim()) {
                        await db.execute(stmt);
                    }
                }
                logger.log('info', 'Migration v2 applied (category column added)');
            } else {
                // Column exists, ensure index exists (idempotent usually, or can wrap too)
                await db.execute("CREATE INDEX IF NOT EXISTS idx_category ON memories(category);");
            }
        } catch (e) {
            logger.log('warn', 'Migration v2 check failed', e);
        }

        // Apply migration v3 - add sync columns
        try {
            const tableInfo = await db.query("PRAGMA table_info(memories);");
            const columns = tableInfo.values?.map((col: any) => col.name) || [];
            
            if (!columns.includes('is_synced')) {
                logger.log('info', '[MemoryDB] Adding is_synced column to memories');
                await db.execute("ALTER TABLE memories ADD COLUMN is_synced INTEGER DEFAULT 0;");
            }
            if (!columns.includes('server_id')) {
                logger.log('info', '[MemoryDB] Adding server_id column to memories');
                await db.execute("ALTER TABLE memories ADD COLUMN server_id TEXT;");
            }
        } catch (e) {
            logger.log('warn', 'Migration v3 (sync) failed', e);
        }

        isSchemaApplied = true;
        return db;
    } catch (error) {
        logger.log('error', 'Failed to initialize memory database', error);
        throw error;
    }
}

/**
 * Get the database connection (Robust Proxy via Manager)
 */
export async function getMemoryDatabase(_forceCheck: boolean = false): Promise<SQLiteDBConnection> {
    // Ensure schema is applied
    if (!isSchemaApplied) {
        try {
            return await initMemoryDatabase();
        } catch (e) {
            logger.log('error', '[MemoryDB] Failed to init schema on get', e);
            return DatabaseManager.getInstance().getDatabase('memory');
        }
    }
    return DatabaseManager.getInstance().getDatabase('memory');
}

/**
 * Reopen database connection (called on app resume)
 */
export async function reopenMemoryDatabase(): Promise<void> {
    try {
        logger.log('info', '[MemoryDB] Reopening database request (handled by Manager)');
        await getMemoryDatabase();
    } catch (error) {
        logger.log('error', '[MemoryDB] Failed to reopen database', error);
    }
}

/**
 * Close the database connection
 */
export async function closeMemoryDatabase(): Promise<void> {
    logger.log('info', '[MemoryDB] Close request ignored (managed centrally)');
}

/**
 * Save a memory with its embedding to the database
 */
export async function saveMemoryToDb(
    id: string,
    sessionId: string,
    role: string,
    content: string,
    embedding: Float32Array
): Promise<void> {
    const database = await getMemoryDatabase();

    // Convert Float32Array to Uint8Array (BLOB)
    const embeddingBlob = new Uint8Array(embedding.buffer);
    const embeddingHex = Array.from(embeddingBlob)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    const timestamp = Date.now();

    try {
        await Promise.race([
            database.run(
                `INSERT OR IGNORE INTO memories (id, session_id, timestamp, role, content, embedding)
                 VALUES (?, ?, ?, ?, ?, X'${embeddingHex}')`,
                [id, sessionId, timestamp, role, content]
            ),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error("database.run TIMEOUT")), 5000))
        ]);
    } catch (error) {
        logger.log('error', 'Failed to save memory to database', error);
        throw error;
    }
}

/**
 * Retrieve memories from database within time range
 */
export async function getRecentMemories(
    limit: number = 50,
    sessionId?: string,
    maxAgeDays: number = 30
): Promise<Array<{
    id: string;
    sessionId: string;
    timestamp: number;
    role: string;
    content: string;
    embedding: Float32Array;
}>> {
    const database = await getMemoryDatabase();

    const minTimestamp = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    let query = `
        SELECT id, session_id, timestamp, role, content, embedding
        FROM memories
        WHERE timestamp > ?
    `;
    const params: any[] = [minTimestamp];

    if (sessionId) {
        query += ` AND session_id = ?`;
        params.push(sessionId);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    try {
        const result = await Promise.race([database.query(query, params), new Promise<any>((_, reject) => setTimeout(() => reject(new Error("database.query TIMEOUT")), 5000))]);

        if (!result.values) {
            return [];
        }

        return result.values.map((row: any) => ({
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            role: row.role,
            content: row.content,
            embedding: blobToFloat32Array(row.embedding),
        }));
    } catch (error) {
        logger.log('error', 'Failed to retrieve memories from database', error);
        return [];
    }
}

/**
 * Delete a memory by ID
 */
export async function deleteMemoryFromDb(id: string): Promise<void> {
    const database = await getMemoryDatabase();

    try {
        await database.run('DELETE FROM memories WHERE id = ?', [id]);
    } catch (error) {
        logger.log('error', 'Failed to delete memory from database', error);
        throw error;
    }
}

/**
 * Delete old memories beyond retention period
 */
export async function pruneOldMemories(maxAgeDays: number = 30): Promise<number> {
    const database = await getMemoryDatabase();

    const minTimestamp = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    try {
        const result = await database.run(
            'DELETE FROM memories WHERE timestamp < ?',
            [minTimestamp]
        );
        logger.log('info', `Pruned ${result.changes?.changes || 0} old memories`);
        return result.changes?.changes || 0;
    } catch (error) {
        logger.log('error', 'Failed to prune old memories', error);
        return 0;
    }
}

/**
 * Get memory count
 */
export async function getMemoryCount(): Promise<number> {
    const database = await getMemoryDatabase();

    try {
        const result = await database.query('SELECT COUNT(*) as count FROM memories');
        return result.values?.[0]?.count || 0;
    } catch (error) {
        logger.log('error', 'Failed to get memory count', error);
        return 0;
    }
}

/**
 * Update category for a semantic memory
 */
export async function updateSemanticMemoryCategory(id: string, category: string): Promise<void> {
    const database = await getMemoryDatabase();

    try {
        await database.run(
            'UPDATE memories SET category = ? WHERE id = ?',
            [category, id]
        );
        logger.log('info', `Updated memory ${id} category to: ${category}`);
    } catch (error) {
        logger.log('error', 'Failed to update memory category', error);
        throw error;
    }
}

/**
 * Get all semantic memories with embeddings for clustering/deduplication
 */
export async function getAllSemanticMemoriesWithEmbeddings(): Promise<Array<{
    id: string;
    sessionId: string;
    timestamp: number;
    role: string;
    content: string;
    embedding: Float32Array;
    category: string;
}>> {
    const database = await getMemoryDatabase();

    try {
        const result = await database.query(
            `SELECT id, session_id, timestamp, role, content, embedding, category 
             FROM memories 
             ORDER BY timestamp ASC` // Oldest first
        );

        if (!result.values) return [];

        return result.values.map((row: any) => ({
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            role: row.role,
            content: row.content,
            embedding: blobToFloat32Array(row.embedding),
            category: row.category || 'semantic',
        }));
    } catch (error) {
        logger.log('error', 'Failed to get all semantic memories with embeddings', error);
        return [];
    }
}

/**
 * Get all semantic memories for UI display (without embeddings for performance)
 */
export async function getAllSemanticMemories(limit: number = 100): Promise<Array<{
    id: string;
    sessionId: string;
    timestamp: number;
    role: string;
    content: string;
    category: string;
}>> {
    const database = await getMemoryDatabase();

    try {
        const result = await database.query(
            `SELECT id, session_id, timestamp, role, content, category 
             FROM memories 
             ORDER BY timestamp DESC 
             LIMIT ?`,
            [limit]
        );

        if (!result.values) return [];

        return result.values.map((row: any) => ({
            id: row.id,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            role: row.role,
            content: row.content,
            category: row.category || 'semantic',
        }));
    } catch (error) {
        logger.log('error', 'Failed to get all semantic memories', error);
        return [];
    }
}

/**
 * Export semantic memories as JSON (without embeddings)
 */
export async function exportSemanticMemories(): Promise<string> {
    const memories = await getAllSemanticMemories(1000);
    return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        memories: memories
    }, null, 2);
}

/**
 * Clear all semantic memories
 */
export async function clearAllSemanticMemories(): Promise<number> {
    const database = await getMemoryDatabase();

    try {
        const result = await database.run('DELETE FROM memories');
        logger.log('info', `Cleared ${result.changes?.changes || 0} semantic memories`);
        return result.changes?.changes || 0;
    } catch (error) {
        logger.log('error', 'Failed to clear semantic memories', error);
        return 0;
    }
}

/**
 * Convert SQLite BLOB to Float32Array
 */
function blobToFloat32Array(blob: any): Float32Array {
    if (!blob) {
        return new Float32Array(384); // Default dimension
    }

    // Handle different blob representations
    if (blob instanceof Uint8Array) {
        return new Float32Array(blob.buffer);
    }

    if (typeof blob === 'string') {
        // Hex string
        const bytes = new Uint8Array(blob.length / 2);
        for (let i = 0; i < blob.length; i += 2) {
            bytes[i / 2] = parseInt(blob.substr(i, 2), 16);
        }
        return new Float32Array(bytes.buffer);
    }

    if (Array.isArray(blob)) {
        return new Float32Array(new Uint8Array(blob).buffer);
    }

    return new Float32Array(384);
}

/**
 * Cleanup function to remove semantically duplicate memories.
 * Call at app startup or periodically to reduce DB bloat.
 * @param similarityThreshold Similarity above which to consider duplicates (default 0.90)
 * @returns Number of duplicates removed
 */
export async function deduplicateExistingMemories(similarityThreshold: number = 0.90): Promise<number> {
    const database = await getMemoryDatabase();
    logger.log('info', `[MemoryDB] Starting deduplication (threshold: ${similarityThreshold})...`);

    try {
        // Get recent memories ordered by timestamp DESC (newer first)
        const result = await database.query(
            `SELECT id, content, embedding, timestamp FROM memories ORDER BY timestamp DESC LIMIT 200`
        );

        if (!result.values || result.values.length < 2) {
            logger.log('info', '[MemoryDB] Not enough memories to deduplicate');
            return 0;
        }

        const memories = result.values.map((row: any) => ({
            id: row.id,
            content: row.content,
            embedding: blobToFloat32Array(row.embedding),
            timestamp: row.timestamp
        }));

        const toDelete: string[] = [];
        const seen = new Set<number>();

        // Compare each pair, keep newer, mark older for deletion
        for (let i = 0; i < memories.length; i++) {
            if (seen.has(i)) continue;

            for (let j = i + 1; j < memories.length; j++) {
                if (seen.has(j)) continue;

                const similarity = computeCosineSimilarity(memories[i].embedding, memories[j].embedding);
                if (similarity >= similarityThreshold) {
                    toDelete.push(memories[j].id);
                    seen.add(j);
                }
            }
        }

        // Delete duplicates
        for (const id of toDelete) {
            await database.run('DELETE FROM memories WHERE id = ?', [id]);
        }

        logger.log('info', `[MemoryDB] ✓ Removed ${toDelete.length} duplicate memories`);
        return toDelete.length;
    } catch (error) {
        logger.log('error', '[MemoryDB] Deduplication failed', error);
        return 0;
    }
}

/**
 * Cosine similarity for deduplication
 */
function computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return (normA === 0 || normB === 0) ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

