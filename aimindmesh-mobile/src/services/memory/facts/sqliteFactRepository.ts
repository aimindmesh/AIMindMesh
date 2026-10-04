/**
 * Facts in SQLite: table memory_facts of the 'memory' database. Writes go through the
 * DatabaseManager write queue. Embeddings are filled in by embeddingReindexer (rows whose
 * embedding_model differs from the active model, including NULL), so a fact gets its vector
 * in the background and a content change only needs embedding_model reset.
 */
import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { DatabaseManager } from '../../database/DatabaseManager';
import { getMemoryDatabase } from '../memoryDatabase';
import { blobToFloat32Array } from '../embeddingCodec';
import { Fact, FactKind, FactSource, FactStatus } from './factTypes';
import { FactRepository } from './factRepository';

export const FACTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT,
  content TEXT NOT NULL,
  category TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  confidence REAL NOT NULL DEFAULT 0.8,
  source TEXT NOT NULL,
  source_thread TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  embedding BLOB,
  embedding_model TEXT,
  is_synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_facts_status ON memory_facts(status, kind);
CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const COLUMNS = `id, kind, subject, content, category, importance, confidence, source, source_thread,
  created_at, updated_at, due_at, status, superseded_by, pinned, last_used_at, use_count`;

function rowToFact(row: any): Fact {
    return {
        id: row.id,
        kind: row.kind as FactKind,
        subject: row.subject ?? undefined,
        content: row.content,
        category: row.category ?? undefined,
        importance: row.importance,
        confidence: row.confidence,
        source: row.source as FactSource,
        sourceThread: row.source_thread ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        dueAt: row.due_at ?? undefined,
        status: row.status as FactStatus,
        supersededBy: row.superseded_by ?? undefined,
        pinned: row.pinned === 1,
        lastUsedAt: row.last_used_at ?? undefined,
        useCount: row.use_count ?? 0,
    };
}

/**
 * Upsert of one fact. The vector is kept unless the text changed (then it is recomputed by
 * the reindexer); is_synced is reset so the server copy is refreshed.
 */
function upsertStatement(fact: Fact): { statement: string; values: any[] } {
    return {
        statement: `INSERT INTO memory_facts (${COLUMNS}, is_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET
              kind = excluded.kind, subject = excluded.subject, category = excluded.category,
              importance = excluded.importance, confidence = excluded.confidence, source = excluded.source,
              source_thread = excluded.source_thread, updated_at = excluded.updated_at, due_at = excluded.due_at,
              status = excluded.status, superseded_by = excluded.superseded_by, pinned = excluded.pinned,
              last_used_at = excluded.last_used_at, use_count = excluded.use_count, is_synced = 0,
              embedding_model = CASE WHEN memory_facts.content = excluded.content THEN memory_facts.embedding_model ELSE NULL END,
              content = excluded.content`,
        values: [
            fact.id, fact.kind, fact.subject ?? null, fact.content, fact.category ?? null, fact.importance,
            fact.confidence, fact.source, fact.sourceThread ?? null, fact.createdAt, fact.updatedAt,
            fact.dueAt ?? null, fact.status, fact.supersededBy ?? null, fact.pinned ? 1 : 0,
            fact.lastUsedAt ?? null, fact.useCount ?? 0,
        ],
    };
}

export class SqliteFactRepository implements FactRepository {
    readonly kind = 'sqlite' as const;

    private write<T>(operation: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
        return DatabaseManager.getInstance().serializedWrite('memory', operation);
    }

    async init(): Promise<void> {
        const db = await getMemoryDatabase();
        await db.execute(FACTS_SCHEMA);
    }

    async loadAll(): Promise<Fact[]> {
        const db = await getMemoryDatabase();
        const result = await db.query(`SELECT ${COLUMNS} FROM memory_facts ORDER BY created_at ASC, id`);
        return (result.values || []).map(rowToFact);
    }

    async upsert(fact: Fact): Promise<void> {
        await this.upsertMany([fact]);
    }

    async upsertMany(facts: Fact[]): Promise<void> {
        if (facts.length === 0) return;
        await this.write(db => db.executeSet(facts.map(upsertStatement), true));
    }

    async remove(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        await this.write(db => db.run(`DELETE FROM memory_facts WHERE id IN (${ids.map(() => '?').join(',')})`, ids));
    }

    async clear(): Promise<void> {
        await this.write(db => db.run('DELETE FROM memory_facts'));
    }

    async touch(ids: string[], at: number): Promise<void> {
        if (ids.length === 0) return;
        await this.write(db => db.run(
            `UPDATE memory_facts SET last_used_at = ?, use_count = use_count + 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
            [at, ...ids]
        ));
    }

    async getMeta(key: string): Promise<string | null> {
        const db = await getMemoryDatabase();
        const result = await db.query('SELECT value FROM memory_meta WHERE key = ?', [key]);
        return result.values?.[0]?.value ?? null;
    }

    async setMeta(key: string, value: string): Promise<void> {
        await this.write(db => db.run(
            'INSERT INTO memory_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, value]
        ));
    }

    async loadEmbeddings(modelKey: string): Promise<Array<{ id: string; vector: Float32Array }>> {
        const db = await getMemoryDatabase();
        const result = await db.query(
            `SELECT id, hex(embedding) AS embedding FROM memory_facts WHERE embedding_model = ? AND embedding IS NOT NULL`,
            [modelKey]
        );
        return (result.values || []).map((row: any) => ({ id: row.id, vector: blobToFloat32Array(row.embedding) }));
    }

    async loadLegacyExtracted(): Promise<Array<{ id: string; sessionId: string; timestamp: number; content: string }>> {
        const db = await getMemoryDatabase();
        const result = await db.query(`SELECT id, session_id, timestamp, content FROM memories WHERE role = 'extracted' ORDER BY timestamp`);
        return (result.values || []).map((r: any) => ({ id: r.id, sessionId: r.session_id, timestamp: r.timestamp, content: r.content }));
    }

    /** Copies the vector of a migrated row (same model): it needs no re-embedding */
    async copyEmbedding(factId: string, sourceMemoryId: string): Promise<void> {
        await this.write(db => db.run(
            `UPDATE memory_facts SET
               embedding = (SELECT embedding FROM memories WHERE id = ?),
               embedding_model = (SELECT embedding_model FROM memories WHERE id = ?)
             WHERE id = ?`,
            [sourceMemoryId, sourceMemoryId, factId]
        ));
    }
}
