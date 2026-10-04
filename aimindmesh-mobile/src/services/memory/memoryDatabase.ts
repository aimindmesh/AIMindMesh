/**
 * Memory Database Service
 * SQLite-backed storage for semantic memory retrieval
 * Refactored to use Centralized DatabaseManager
 */

import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../logger';
import { DatabaseManager } from '../database/DatabaseManager';
import { blobToFloat32Array, cosineSimilarity, float32ToHex } from './embeddingCodec';

export { blobToFloat32Array };

/**
 * Summaries never age out of retrieval; chat turns (user/model) do, and are pruned after
 * RAW_RETENTION_DAYS. Rows of role 'extracted' (facts of older versions) moved to the facts
 * store: retrieval ignores them.
 */
const LONG_LIVED_ROLES_SQL = `role = 'system'`;
export const RAW_RETENTION_DAYS = 90;

// Schema with category support. embedding_model: key of the model that produced the vector
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
  server_id TEXT,
  embedding_model TEXT
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

        // Migrations v3 (sync columns) and v4 (embedding model tag): rows of older installs
        // have a NULL model and are re-embedded by embeddingReindexer
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
            if (!columns.includes('embedding_model')) {
                logger.log('info', '[MemoryDB] Adding embedding_model column to memories');
                await db.execute("ALTER TABLE memories ADD COLUMN embedding_model TEXT;");
            }
            await db.execute("CREATE INDEX IF NOT EXISTS idx_memories_model ON memories(embedding_model, timestamp DESC);");
        } catch (e) {
            logger.log('warn', 'Migrations v3/v4 failed', e);
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

const QUERY_TIMEOUT_MS = 5000;
const withTimeout = <T,>(promise: Promise<T>, label: string, ms: number = QUERY_TIMEOUT_MS) => Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} TIMEOUT`)), ms)),
]);

/**
 * Save a memory with its embedding (tagged with the producing model's key).
 * The timeout only unblocks the caller: the native insert may still complete afterwards,
 * so callers that must replace rows use replaceMemoriesAtomically instead.
 */
export async function saveMemoryToDb(
    id: string,
    sessionId: string,
    role: string,
    content: string,
    embedding: Float32Array,
    modelKey: string | null = null
): Promise<void> {
    const database = await getMemoryDatabase();
    const timestamp = Date.now();

    try {
        await withTimeout(database.run(
            `INSERT OR IGNORE INTO memories (id, session_id, timestamp, role, content, embedding, embedding_model)
             VALUES (?, ?, ?, ?, ?, X'${float32ToHex(embedding)}', ?)`,
            [id, sessionId, timestamp, role, content, modelKey]
        ), 'database.run');
    } catch (error) {
        logger.log('error', 'Failed to save memory to database', error);
        throw error;
    }
}

/**
 * Insert a memory and delete the ones it replaces (summary/consolidation) in one transaction:
 * either both happen or neither, even if the caller gives up waiting.
 */
export async function replaceMemoriesAtomically(
    row: { id: string; sessionId: string; role: string; content: string; embedding: Float32Array; modelKey: string; timestamp?: number },
    replacedIds: string[]
): Promise<void> {
    const database = await getMemoryDatabase();
    const set = [{
        statement: `INSERT INTO memories (id, session_id, timestamp, role, content, embedding, embedding_model)
                    VALUES (?, ?, ?, ?, ?, X'${float32ToHex(row.embedding)}', ?)`,
        values: [row.id, row.sessionId, row.timestamp ?? Date.now(), row.role, row.content, row.modelKey],
    }];
    if (replacedIds.length > 0) {
        set.push({ statement: `DELETE FROM memories WHERE id IN (${replacedIds.map(() => '?').join(',')})`, values: replacedIds });
    }
    await withTimeout(database.executeSet(set, true), 'replaceMemoriesAtomically', 15000);
}

/**
 * Retrieve memories from database within time range (optionally of one embedding model only)
 */
export async function getRecentMemories(
    limit: number = 50,
    sessionId?: string,
    maxAgeDays: number = 30,
    modelKey?: string
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
        SELECT id, session_id, timestamp, role, content, hex(embedding) AS embedding
        FROM memories
        WHERE timestamp > ?
    `;
    const params: any[] = [minTimestamp];

    if (sessionId) {
        query += ` AND session_id = ?`;
        params.push(sessionId);
    }
    if (modelKey) {
        query += ` AND embedding_model = ?`;
        params.push(modelKey);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    try {
        const result = await withTimeout(database.query(query, params), 'database.query');

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
 * id, session, time and embedding (no text) of every memory of `modelKey` that retrieval may
 * use: chat turns of the last `maxAgeDays`, summaries of any age. Read in
 * pages so a single bridge call never carries thousands of vectors.
 */
export async function getMemoryEmbeddings(
    maxAgeDays: number,
    modelKey: string,
    pageSize: number = 250
): Promise<Array<{ id: string; sessionId: string; timestamp: number; embedding: Float32Array }>> {
    const database = await getMemoryDatabase();
    const minTimestamp = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const rows: Array<{ id: string; sessionId: string; timestamp: number; embedding: Float32Array }> = [];

    for (let offset = 0; ; offset += pageSize) {
        const result = await withTimeout(database.query(
            `SELECT id, session_id, timestamp, hex(embedding) AS embedding FROM memories
             WHERE embedding_model = ? AND role != 'extracted' AND (timestamp > ? OR ${LONG_LIVED_ROLES_SQL})
             ORDER BY timestamp DESC, id LIMIT ? OFFSET ?`,
            [modelKey, minTimestamp, pageSize, offset]
        ), 'getMemoryEmbeddings');
        const page = result.values || [];
        for (const row of page) {
            rows.push({ id: row.id, sessionId: row.session_id, timestamp: row.timestamp, embedding: blobToFloat32Array(row.embedding) });
        }
        if (page.length < pageSize) return rows;
    }
}

/** Text and metadata of the given memories (no embeddings). */
export async function getMemoriesByIds(
    ids: string[]
): Promise<Array<{ id: string; sessionId: string; timestamp: number; role: string; content: string }>> {
    if (ids.length === 0) return [];
    const database = await getMemoryDatabase();
    const result = await withTimeout(database.query(
        `SELECT id, session_id, timestamp, role, content FROM memories WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    ), 'getMemoriesByIds');
    return (result.values || []).map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        timestamp: row.timestamp,
        role: row.role,
        content: row.content,
    }));
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
 * Delete chat turns (user/model) older than the retention period. They are already outside
 * the retrieval window; extracted facts and summaries are kept.
 */
export async function pruneOldMemories(maxAgeDays: number = RAW_RETENTION_DAYS): Promise<number> {
    const database = await getMemoryDatabase();

    const minTimestamp = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    try {
        const result = await database.run(
            `DELETE FROM memories WHERE timestamp < ? AND role IN ('user', 'model')`,
            [minTimestamp]
        );
        logger.log('info', `Pruned ${result.changes?.changes || 0} old memories`);
        return result.changes?.changes || 0;
    } catch (error) {
        logger.log('error', 'Failed to prune old memories', error);
        return 0;
    }
}

/** Raw chat turns (user/model rows) stored before conversations were summarized instead */
export async function countRawMemories(): Promise<number> {
    const database = await getMemoryDatabase();
    try {
        const result = await database.query(`SELECT COUNT(*) as count FROM memories WHERE role IN ('user', 'model')`);
        return result.values?.[0]?.count || 0;
    } catch (error) {
        logger.log('error', 'Failed to count raw memories', error);
        return 0;
    }
}

/** Deletes the raw chat turns, on the user's request (summaries and facts stay) */
export async function deleteRawMemories(): Promise<number> {
    const database = await getMemoryDatabase();
    const result = await database.run(`DELETE FROM memories WHERE role IN ('user', 'model')`);
    return result.changes?.changes || 0;
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
            'UPDATE memories SET category = ?, is_synced = 0 WHERE id = ?', // pushed again at the next sync
            [category, id]
        );
        logger.log('info', `Updated memory ${id} category to: ${category}`);
    } catch (error) {
        logger.log('error', 'Failed to update memory category', error);
        throw error;
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
 * Cleanup function to remove semantically duplicate memories.
 * Only rows of the same role and embedding model are compared: a fact is never dropped
 * because a chat turn says the same thing (the turn is pruned later, the fact would be lost).
 * @param similarityThreshold Similarity above which to consider duplicates (default 0.95)
 * @returns Number of duplicates removed
 */
export async function deduplicateExistingMemories(similarityThreshold: number = 0.95): Promise<number> {
    const database = await getMemoryDatabase();
    logger.log('info', `[MemoryDB] Starting deduplication (threshold: ${similarityThreshold})...`);

    try {
        // Get recent memories ordered by timestamp DESC (newer first)
        const result = await database.query(
            `SELECT id, role, hex(embedding) AS embedding, embedding_model FROM memories
             WHERE embedding_model IS NOT NULL ORDER BY timestamp DESC LIMIT 200`
        );

        if (!result.values || result.values.length < 2) {
            logger.log('info', '[MemoryDB] Not enough memories to deduplicate');
            return 0;
        }

        const memories = result.values.map((row: any) => ({
            id: row.id,
            role: row.role,
            model: row.embedding_model,
            embedding: blobToFloat32Array(row.embedding),
        }));

        const toDelete: string[] = [];
        const seen = new Set<number>();

        // Compare each pair, keep newer, mark older for deletion
        for (let i = 0; i < memories.length; i++) {
            if (seen.has(i)) continue;

            for (let j = i + 1; j < memories.length; j++) {
                if (seen.has(j) || memories[j].model !== memories[i].model || memories[j].role !== memories[i].role) continue;

                const similarity = cosineSimilarity(memories[i].embedding, memories[j].embedding);
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
