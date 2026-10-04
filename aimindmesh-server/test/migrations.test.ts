import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { addColumnIfMissing, getSchemaVersion, LATEST_SCHEMA_VERSION, Migration, MIGRATIONS, runMigrations } from '../src/db/migrations';
import { BASELINE_TABLES_SQL } from '../src/db/schema/baseline';

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
const indexes = (db: Database.Database) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map(i => i.name);

const candidate = (db: Database.Database, id: string) => db.prepare(`
  INSERT INTO evolution_candidates (id, source, source_id, title, description, target_component, created_at)
  VALUES (?, 'detector', 'src-1', 'Same title', 'd', 'server', 0)`).run(id);

describe('schema migrations', () => {
  it('builds a fresh database up to the latest version', () => {
    const db = new Database(':memory:');
    expect(runMigrations(db)).toEqual(MIGRATIONS.map(m => m.version));
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(columns(db, 'direct_chats')).toEqual(expect.arrayContaining(['conversation_id', 'device_id', 'received_at']));
    expect(columns(db, 'ingestion_jobs')).toEqual(expect.arrayContaining(['created_at', 'updated_at', 'content_hash']));
    expect(columns(db, 'meetings')).toEqual(expect.arrayContaining(['title', 'bookmarks_json', 'analysis_json', 'questions_json']));
    expect(indexes(db)).toEqual(expect.arrayContaining([
      'idx_candidates_source_title', 'idx_system_logs_timestamp', 'idx_system_logs_module_ts', 'idx_direct_chats_received_at',
    ]));
  });

  it('is a no-op once applied', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(runMigrations(db)).toEqual([]);
  });

  it('adopts a production database at version 0 keeping its data', () => {
    const db = new Database(':memory:');
    // What the old boot code left behind: every table, without a schema version
    db.exec(BASELINE_TABLES_SQL);
    db.prepare(`INSERT INTO system_logs (id, timestamp, level, module, message) VALUES ('l1', 1, 'info', 'm', 'kept')`).run();
    db.prepare(`INSERT INTO nodes (id, type) VALUES ('server_local', 'server')`).run();
    candidate(db, 'c1');
    candidate(db, 'c2'); // duplicates: the unique index must be skipped, not fail the boot
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    runMigrations(db);

    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare(`SELECT message FROM system_logs`).get()).toEqual({ message: 'kept' });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE id = 'server_local'`).get()).toEqual({ c: 0 });
    expect(indexes(db)).not.toContain('idx_candidates_source_title');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate evolution candidate'));
  });

  it('v7 parks looping venture repos and switches autonomous discovery off', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS.filter(m => m.version < 7));
    db.prepare(`INSERT INTO organization_discovery_config (id, enabled, updated_at) VALUES ('singleton', 1, 'now')`).run();
    const repo = db.prepare(`INSERT INTO organization_repositories (id, repo_name, namespace, gitea_url, bootstrap_template, validation_status, created_at) VALUES (?, ?, 'labs', 'u', 'node-webapp', ?, 'now')`);
    repo.run('r1', 'looping', 'cooldown');
    repo.run('r2', 'built', 'healthy');
    repo.run('r3', 'fresh', 'pending');

    runMigrations(db);

    expect(db.prepare(`SELECT enabled FROM organization_discovery_config`).get()).toEqual({ enabled: 0 });
    const status = db.prepare(`SELECT validation_status AS s, blocked_reason AS r FROM organization_repositories WHERE id = ?`);
    expect(status.get('r1')).toEqual({ s: 'blocked', r: 'paused by upgrade' });
    expect(status.get('r3')).toEqual({ s: 'blocked', r: 'paused by upgrade' });
    expect(status.get('r2')).toEqual({ s: 'healthy', r: null });
    expect(columns(db, 'organization_repositories')).toEqual(expect.arrayContaining(['active_run_id']));
    expect(columns(db, 'evolution_proposals')).toEqual(expect.arrayContaining(['iteration_count', 'last_feedback_at']));
  });

  it('v8 scopes council directives to their idea', () => {
    const db = new Database(':memory:');
    runMigrations(db, MIGRATIONS.filter(m => m.version < 8));
    const directive = db.prepare(`INSERT INTO organization_directives (id, title, description, goal_type, constraints, priority, created_by, created_at, updated_at)
      VALUES (?, 't', 'd', 'build', '{}', 50, ?, 'now', 'now')`);
    directive.run('d1', 'system:council-debate:idea-42');
    directive.run('d2', 'director');

    runMigrations(db);

    const ideaOf = db.prepare(`SELECT idea_id AS i FROM organization_directives WHERE id = ?`);
    expect(ideaOf.get('d1')).toEqual({ i: 'idea-42' });
    expect(ideaOf.get('d2')).toEqual({ i: null });
    expect(columns(db, 'organization_ideas')).toEqual(expect.arrayContaining(['sources_json']));
  });

  it('leaves the version untouched when a migration fails', () => {
    const db = new Database(':memory:');
    const failing: Migration[] = [
      { version: 1, name: 'creates', up: d => d.exec(`CREATE TABLE t (x)`) },
      { version: 2, name: 'breaks', up: () => { throw new Error('boom'); } },
    ];
    expect(() => runMigrations(db, failing)).toThrow('Migration v2 (breaks) failed: boom');
    expect(getSchemaVersion(db)).toBe(0);
    expect(indexes(db)).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 't'`).get()).toEqual({ c: 0 });
  });

  it('refuses a database newer than the server', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(db)).toThrow(/newer than this server/);
  });

  it('addColumnIfMissing adds once and rejects bad input', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE t (a)`);
    expect(addColumnIfMissing(db, 't', 'b', 'TEXT')).toBe(true);
    expect(addColumnIfMissing(db, 't', 'b', 'TEXT')).toBe(false);
    expect(() => addColumnIfMissing(db, 'missing', 'b', 'TEXT')).toThrow('Table not found');
    expect(() => addColumnIfMissing(db, 't; DROP TABLE t', 'b', 'TEXT')).toThrow('Invalid table name');
    expect(() => addColumnIfMissing(db, 't', 'b c', 'TEXT')).toThrow('Invalid column name');
  });
});
