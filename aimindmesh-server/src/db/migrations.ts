import type { Database } from 'better-sqlite3';
import { BASELINE_TABLES_SQL } from './schema/baseline';

/**
 * Versioned schema migrations for the operational database.
 *
 * The schema version is stored in `PRAGMA user_version`. Pending migrations run in a
 * single transaction: either all apply (and the version moves) or none does, and any
 * error stops the boot instead of being silently ignored.
 *
 * v1 is idempotent on purpose: production databases (and restored backups) arrive at
 * version 0 with most columns already present.
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const IDENTIFIER = /^\w+$/;

function columnNames(db: Database, table: string): string[] {
  if (!IDENTIFIER.test(table)) throw new Error(`Invalid table name: ${table}`);
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.length === 0) throw new Error(`Table not found: ${table}`);
  return rows.map(r => r.name);
}

/** Adds a column only if it does not exist yet. A missing table is a real error. */
export function addColumnIfMissing(db: Database, table: string, column: string, definition: string): boolean {
  if (!IDENTIFIER.test(column)) throw new Error(`Invalid column name: ${column}`);
  if (columnNames(db, table).includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

// Columns added over time to tables of the baseline (previously `try { ALTER } catch {}`)
const BASELINE_COLUMNS: [table: string, column: string, definition: string][] = [
  ['gemini_calls', 'api_key_hash', "TEXT DEFAULT 'default'"],
  ['evolution_candidates', 'repository', "TEXT NOT NULL DEFAULT 'AIMindMesh'"],
  ['evolution_candidates', 'original_content', 'TEXT'],
  ['evolution_candidates', 'affected_components', 'TEXT'],
  ['evolution_candidates', 'change_scope', "TEXT DEFAULT 'single_file'"],
  ['evolution_proposals', 'repository', "TEXT NOT NULL DEFAULT 'AIMindMesh'"],
  ['evolution_proposals', 'feedback_status', "TEXT DEFAULT 'none'"],
  ['direct_chats', 'conversation_id', 'TEXT'],
  ['direct_chats', 'device_id', 'TEXT'],
  ['conversations', 'device_id', 'TEXT'],
  ['ingestion_jobs', 'doc_id', 'TEXT'],
  ['ingestion_jobs', 'mode', "TEXT DEFAULT 'STANDARD'"],
  ['ingestion_jobs', 'type', "TEXT DEFAULT 'file'"],
  ['ingestion_jobs', 'source', "TEXT NOT NULL DEFAULT 'unknown'"],
  ['ingestion_jobs', 'mime_type', 'TEXT'],
  ['ingestion_jobs', 'total_chunks', 'INTEGER DEFAULT 0'],
  ['ingestion_jobs', 'done_chunks', 'INTEGER DEFAULT 0'],
  ['ingestion_jobs', 'error_msg', 'TEXT'],
  // The historical DEFAULT (strftime(...)) is rejected by ALTER TABLE: use a constant
  ['ingestion_jobs', 'created_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['ingestion_jobs', 'updated_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['ingestion_jobs', 'content_hash', 'TEXT'],
  ['ingestion_jobs', 'original_name', 'TEXT'],
  ['inference_queue', 'result', 'TEXT'],
  ['inference_queue', 'error_msg', 'TEXT'],
  ['inference_queue', 'provider', 'TEXT'],
  ['inference_queue', 'source_id', 'TEXT'],
  ['inference_queue', 'completed_at', 'INTEGER'],
  ['organization_ideas', 'analysis_synthesis', 'TEXT'],
  ['organization_ideas', 'human_feedback', 'TEXT'],
  ['organization_repositories', 'agent_last_triggered_at', 'TEXT'],
  ['organization_repositories', 'last_ci_status', 'TEXT'],
  ['organization_repositories', 'last_ci_at', 'TEXT'],
  ['organization_repositories', 'cooldown_until', 'TEXT'],
  ['organization_repositories', 'retry_count', 'INTEGER DEFAULT 0'],
  ['debate_threads', 'merged_into', 'TEXT'],
  ['ai_tasks', 'provider', "TEXT NOT NULL DEFAULT 'auto'"],
];

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline',
    up: db => {
      db.exec(BASELINE_TABLES_SQL);
      for (const [table, column, definition] of BASELINE_COLUMNS) addColumnIfMissing(db, table, column, definition);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_gemini_calls_key_ts ON gemini_calls(api_key_hash, timestamp)`);

      // Unique candidates: only if existing data allows it (otherwise keep running and report)
      const duplicates = db.prepare(`
        SELECT COUNT(*) AS c FROM (
          SELECT 1 FROM evolution_candidates GROUP BY source, source_id, title HAVING COUNT(*) > 1
        )`).get() as { c: number };
      if (duplicates.c === 0) {
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_source_title ON evolution_candidates(source, source_id, title)`);
      } else {
        console.warn(`[DB] ${duplicates.c} duplicate evolution candidate group(s): unique index idx_candidates_source_title not created`);
      }

      // Legacy lowercase id from before the mesh normalization (v4.0.0)
      db.exec(`DELETE FROM nodes WHERE id = 'server_local'`);
    },
  },
  {
    version: 2,
    name: 'system_logs indexes',
    up: db => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_system_logs_module_ts ON system_logs(module, timestamp);
      `);
    },
  },
  {
    version: 3,
    name: 'direct_chats.received_at (server-side sync cursor)',
    up: db => {
      addColumnIfMissing(db, 'direct_chats', 'received_at', 'INTEGER');
      db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_chats_received_at ON direct_chats(received_at)`);
    },
  },
  {
    version: 4,
    name: 'sync_tombstones (deletions propagated between devices)',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_tombstones (
          entity_type TEXT NOT NULL,
          entity_id   TEXT NOT NULL,
          device_id   TEXT NOT NULL,
          deleted_at  INTEGER NOT NULL,
          received_at INTEGER NOT NULL,
          PRIMARY KEY (entity_type, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_tombstones_received_at ON sync_tombstones(received_at);
      `);
    },
  },
  {
    version: 5,
    name: 'node_settings: upper-case device ids, quiet hours and time zone per device',
    up: db => {
      addColumnIfMissing(db, 'node_settings', 'quiet_enabled', 'INTEGER');
      addColumnIfMissing(db, 'node_settings', 'quiet_start', 'TEXT');
      addColumnIfMissing(db, 'node_settings', 'quiet_end', 'TEXT');
      addColumnIfMissing(db, 'node_settings', 'timezone', 'TEXT');
      // Rows were written from the raw x-device-id header (lower case) while nodes are upper case:
      // the setting the user chose moves to the id the scheduler looks up
      db.exec(`
        INSERT OR REPLACE INTO node_settings (node_id, delivery_mode, quiet_enabled, quiet_start, quiet_end, timezone)
          SELECT UPPER(node_id), delivery_mode, quiet_enabled, quiet_start, quiet_end, timezone
          FROM node_settings WHERE node_id != UPPER(node_id);
        DELETE FROM node_settings WHERE node_id != UPPER(node_id);
      `);
    },
  },
  {
    version: 6,
    name: 'meetings: notes synced between devices (title, bookmarks, AI analysis, questions)',
    up: db => {
      addColumnIfMissing(db, 'meetings', 'title', 'TEXT');
      addColumnIfMissing(db, 'meetings', 'bookmarks_json', 'TEXT');
      addColumnIfMissing(db, 'meetings', 'analysis_json', 'TEXT');
      addColumnIfMissing(db, 'meetings', 'questions_json', 'TEXT');
    },
  },
  {
    version: 7,
    name: 'venture factory kill switch: run lock and blocked reason, discovery off, PR feedback iteration columns',
    up: db => {
      addColumnIfMissing(db, 'organization_repositories', 'blocked_reason', 'TEXT');
      addColumnIfMissing(db, 'organization_repositories', 'active_run_id', 'TEXT');
      // Read and written by FeedbackService since the start, never created: the PR feedback loop failed on them
      addColumnIfMissing(db, 'evolution_proposals', 'iteration_count', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'evolution_proposals', 'last_feedback_at', 'INTEGER');
      // The DB row, not config.json, decides whether discovery runs: switch it off until it is re-enabled by hand
      db.exec(`UPDATE organization_discovery_config SET enabled = 0`);
      // Repos the old watchdog would resume forever wait for a human "unblock"
      db.exec(`
        UPDATE organization_repositories
        SET validation_status = 'blocked', blocked_reason = 'paused by upgrade'
        WHERE validation_status IN ('pending', 'evolving', 'cooldown', 'verifying', 'needs_verification')
      `);
    },
  },
  {
    version: 8,
    name: 'venture factory: directives scoped to their idea, structured idea sources, last validation',
    up: db => {
      addColumnIfMissing(db, 'organization_directives', 'idea_id', 'TEXT');
      addColumnIfMissing(db, 'organization_ideas', 'sources_json', 'TEXT');
      // Outcome of the last server-side validation (JSON), fed to the next agent run
      addColumnIfMissing(db, 'organization_repositories', 'last_validation', 'TEXT');
      // Directives extracted from a council debate were global: they steered discovery and every other venture
      db.exec(`
        UPDATE organization_directives SET idea_id = substr(created_by, length('system:council-debate:') + 1)
        WHERE idea_id IS NULL AND created_by LIKE 'system:council-debate:%';
        CREATE INDEX IF NOT EXISTS idx_org_directives_idea ON organization_directives(idea_id, status);
      `);
    },
  },
  {
    version: 9,
    name: 'venture funnel: judge rationale and outcome notes, structured spec, milestones',
    up: db => {
      addColumnIfMissing(db, 'organization_ideas', 'judge_rationale', 'TEXT');
      addColumnIfMissing(db, 'organization_ideas', 'outcome_notes', 'TEXT');
      // Structured specification (features, interface, acceptance criteria, milestones) and the
      // server-owned acceptance test files generated from it
      addColumnIfMissing(db, 'organization_product_designs', 'spec_json', 'TEXT');
      addColumnIfMissing(db, 'organization_product_designs', 'acceptance_json', 'TEXT');
      db.exec(`
        CREATE TABLE IF NOT EXISTS organization_venture_milestones (
          id TEXT PRIMARY KEY,
          idea_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          title TEXT NOT NULL,
          criteria_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          passed_json TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_venture_milestones_idea_seq ON organization_venture_milestones(idea_id, seq);
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function getSchemaVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Applies every pending migration in one transaction. Returns the versions applied. */
export function runMigrations(db: Database, migrations: Migration[] = MIGRATIONS): number[] {
  const current = getSchemaVersion(db);
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (current > latest) {
    throw new Error(`Database schema version ${current} is newer than this server (${latest}): refusing to start`);
  }
  const pending = migrations.filter(m => m.version > current);
  if (pending.length === 0) return [];

  db.transaction(() => {
    for (const migration of pending) {
      try {
        migration.up(db);
      } catch (err: any) {
        throw new Error(`Migration v${migration.version} (${migration.name}) failed: ${err.message}`);
      }
      db.pragma(`user_version = ${migration.version}`);
    }
  })();
  console.info(`[DB] Schema migrated ${current} -> ${pending[pending.length - 1].version}`);
  return pending.map(m => m.version);
}
