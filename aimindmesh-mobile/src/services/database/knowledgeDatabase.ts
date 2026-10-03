/**
 * Knowledge Database Service
 * SQLite-backed storage for RAG Documents and Workspaces.
 * Refactored to use Centralized DatabaseManager
 */

import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../logger';
import { DatabaseManager } from './DatabaseManager';

// ========================================
// SCHEMAS
// ========================================

const DOCUMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  title TEXT,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  total_chunks INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER,
  metadata TEXT,
  is_synced INTEGER DEFAULT 0,
  server_id TEXT
)`;

const CHUNKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS document_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  token_count INTEGER,
  page_number INTEGER,
  chunk_metadata TEXT,
  is_synced INTEGER DEFAULT 0,
  server_id TEXT,
  embedding_model TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  content='document_chunks',
  content_rowid='id'
)`;

const FTS_TRIGGERS = [
  // Insert Trigger
  `CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;`,
  // Delete Trigger
  `CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
  END;`,
  // Update Trigger: only when the text changes (re-embedding updates the vector alone)
  `CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE OF content ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO document_chunks_fts(rowid, content) VALUES (new.id, new.content);
  END;`
];
const FTS_TRIGGER_NAMES = ['document_chunks_ai', 'document_chunks_ad', 'document_chunks_au'];

/** Documents being ingested: chunks are written in batches, the real count is set at the end */
export const INGESTING_CHUNK_COUNT = -1;

const WORKSPACES_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT '📁',
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  settings TEXT
)`;

const WORKSPACE_DOCUMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace_documents (
  workspace_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, document_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
)`;

const WORKSPACE_THREADS_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspace_threads (
  workspace_id INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, thread_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
)`;

// ========================================
// SERVICE IMPLEMENTATION
// ========================================

let isSchemaApplied = false;

/**
 * Initialize Knowledge Database Schemas
 * Called after DatabaseManager has opened the connection.
 */
export async function initKnowledgeDatabase(): Promise<SQLiteDBConnection> {
  const db = await DatabaseManager.getInstance().getDatabase('knowledge');

  if (isSchemaApplied) {
    return db;
  }

  logger.logToAppOnly('info', '[KnowledgeDB] Applying schemas...');

  try {
    const schemas = [
      { name: 'documents', sql: DOCUMENTS_SCHEMA },
      { name: 'chunks', sql: CHUNKS_SCHEMA },
      { name: 'document_chunks_fts', sql: FTS_SCHEMA },
      { name: 'workspaces', sql: WORKSPACES_SCHEMA },
      { name: 'workspace_documents', sql: WORKSPACE_DOCUMENTS_SCHEMA },
      { name: 'workspace_threads', sql: WORKSPACE_THREADS_SCHEMA }
    ];

    for (const schema of schemas) {
      try {
        await db.execute(schema.sql);
      } catch (e) {
        logger.logToAppOnly('error', `[KnowledgeDB] FAILED to create table ${schema.name}:`, e);
        if (schema.name === 'document_chunks_fts') {
          logger.logToAppOnly('warn', '[KnowledgeDB] FTS5 may not be supported on this device/runtime');
        } else {
          throw e;
        }
      }
    }

    // Apply FTS Triggers. Without the FTS table (no FTS5) they must not exist: every chunk
    // insert would fail on the missing table. The update trigger of older installs fired on
    // any column, so it is recreated.
    const fts = await db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document_chunks_fts'`);
    const hasFts = (fts.values || []).length > 0;
    try {
      await db.run('DROP TRIGGER IF EXISTS document_chunks_au', [], false);
      if (!hasFts) {
        for (const name of FTS_TRIGGER_NAMES) await db.run(`DROP TRIGGER IF EXISTS ${name}`, [], false);
      }
    } catch (e) {
      logger.logToAppOnly('error', '[KnowledgeDB] Failed to drop FTS triggers:', e);
    }
    for (const triggerSql of hasFts ? FTS_TRIGGERS : []) {
      try {
        await db.run(triggerSql, [], false);
      } catch (e) {
        logger.logToAppOnly('error', '[KnowledgeDB] Failed to create trigger:', e);
      }
    }

    logger.logToAppOnly('info', '[KnowledgeDB] Schemas applied successfully');

    // ── MIGRATIONS ──────────────────────────────────────────────────
    try {
      const tables = ['documents', 'document_chunks'];
      for (const table of tables) {
        const tableInfo = await db.query(`PRAGMA table_info(${table});`);
        const columns = tableInfo.values?.map((col: any) => col.name) || [];
        
        if (!columns.includes('is_synced')) {
          logger.logToAppOnly('info', `[KnowledgeDB] Adding is_synced column to ${table}`);
          await db.execute(`ALTER TABLE ${table} ADD COLUMN is_synced INTEGER DEFAULT 0;`);
        }
        if (!columns.includes('server_id')) {
          logger.logToAppOnly('info', `[KnowledgeDB] Adding server_id column to ${table}`);
          await db.execute(`ALTER TABLE ${table} ADD COLUMN server_id TEXT;`);
        }
        // Key of the model that produced the chunk vector (NULL: re-embedded in the background)
        if (table === 'document_chunks' && !columns.includes('embedding_model')) {
          logger.logToAppOnly('info', '[KnowledgeDB] Adding embedding_model column to document_chunks');
          await db.execute(`ALTER TABLE document_chunks ADD COLUMN embedding_model TEXT;`);
        }
      }
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_chunks_model ON document_chunks(embedding_model);`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);`);
    } catch (migErr) {
      logger.logToAppOnly('warn', '[KnowledgeDB] Migration failed (likely already up to date)', migErr);
    }

    // Ingestions interrupted by an app kill: the document and its partial chunks (cascade)
    try {
      const removed = await db.run('DELETE FROM documents WHERE total_chunks = ?', [INGESTING_CHUNK_COUNT]);
      if (removed.changes?.changes) {
        logger.logToAppOnly('warn', `[KnowledgeDB] Removed ${removed.changes.changes} partially ingested documents`);
      }
    } catch (cleanupErr) {
      logger.logToAppOnly('warn', '[KnowledgeDB] Cleanup of partial documents failed', cleanupErr);
    }

    isSchemaApplied = true;
    return db;

  } catch (error) {
    logger.logToAppOnly('error', '[KnowledgeDB] Schema initialization FAILED:', error);
    throw error;
  }
}

/**
 * Get Database Connection
 * Delegates to DatabaseManager
 */
export async function getKnowledgeDatabase(): Promise<SQLiteDBConnection> {
  // We ensure schema is applied if we can, but primarily we just need the connection
  if (!isSchemaApplied) {
    try {
      return await initKnowledgeDatabase();
    } catch (e) {
      logger.logToAppOnly('error', '[KnowledgeDB] Failed to init schema on get, returning DB anyway', e);
      return DatabaseManager.getInstance().getDatabase('knowledge');
    }
  }
  return DatabaseManager.getInstance().getDatabase('knowledge');
}

/**
 * Set whether to ping the database on retrieval
 * (Kept for compatibility, though DatabaseManager handles this logic centrally now)
 */
export function setKnowledgeDbPingEnabled(_enabled: boolean) {
  // No-op in new architecture, or could pass config to Manager
  logger.logToAppOnly('info', '[KnowledgeDB] setKnowledgeDbPingEnabled: Deprecated in favor of DatabaseManager');
}

/**
 * Reopen database connection (called on app resume)
 * (Kept for compatibility)
 */
export async function reopenKnowledgeDatabase(): Promise<void> {
  // DatabaseManager handles this via global re-init, but we can ensure we get a fresh reference
  await getKnowledgeDatabase();
}

/**
 * Close Database
 */
export async function closeKnowledgeDatabase(): Promise<void> {
  // We shouldn't close individual databases in the centralized model usually,
  // but if needed we can ask the manager or just ignore.
  // For now, we'll let the Manager handle global lifecycle.
  logger.log('info', '[KnowledgeDB] closeKnowledgeDatabase: Managed by DatabaseManager');
}
