import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';

vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { setBrake: vi.fn() } }));

import db from '../src/db/sqlite';
import { BackupService } from '../src/services/BackupService';
import { applyPendingRestore, defaultRestorePaths, LAST_RESTORE, RESTORE_MARKER, RESTORE_STAGING, RestorePaths } from '../src/db/restore';
import { LATEST_SCHEMA_VERSION } from '../src/db/migrations';

let root: string;
let paths: RestorePaths;
const original = BackupService.paths;

const file = (rel: string) => path.join(root, rel);
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), content);
};
const read = (rel: string) => fs.readFileSync(file(rel), 'utf-8');
const tarList = (archive: string) => execFileSync('tar', ['-tzf', archive], { encoding: 'utf-8' }).split('\n').filter(Boolean);

/** A live database in WAL mode with one marker row, like the server's. */
function liveDb(label: string) {
  const live = new Database(file('data/operational.db'));
  live.pragma('journal_mode = WAL');
  live.exec(`CREATE TABLE IF NOT EXISTS marker (label TEXT)`);
  live.prepare(`INSERT INTO marker VALUES (?)`).run(label);
  return live; // left open: its -wal file exists
}
const markerLabels = () => {
  const check = new Database(file('data/operational.db'), { readonly: true });
  try { return (check.prepare(`SELECT label FROM marker`).all() as { label: string }[]).map(r => r.label); } finally { check.close(); }
};

/** Archive built by hand, to test what old or hostile backups may contain. */
function archive(name: string, build: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimm-archive-'));
  build(dir);
  execFileSync('tar', ['-czf', path.join(paths.backupDir, name), '-C', dir, '.']);
  fs.rmSync(dir, { recursive: true, force: true });
  return name;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aimm-restore-'));
  paths = defaultRestorePaths(root);
  BackupService.paths = paths;
  fs.mkdirSync(paths.backupDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true }); // sqlite.ts creates it at boot
  vi.spyOn(BackupService, 'isSupervised').mockReturnValue(false);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.exec(`DROP TABLE IF EXISTS marker; CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('backup')`);
});

afterEach(() => {
  BackupService.paths = original;
  db.exec(`DROP TABLE IF EXISTS marker`);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('backup creation', () => {
  it('archives a DB snapshot, config and wiki, never the live DB or other containers\' data', async () => {
    write('config.json', '{"v":"backup"}');
    write('data/wiki/page.md', 'wiki');
    write('data/neo4j/store', 'x');
    write('data/freellmapi/db', 'x');
    write('data/downloads/versions.json', '{}');
    liveDb('live').close();

    const name = await BackupService.createBackup();
    const entries = tarList(path.join(paths.backupDir, name));

    expect(entries).toEqual(expect.arrayContaining(['config.json', 'data/wiki/page.md', 'data/operational.db.bak']));
    expect(entries.filter(e => /neo4j|freellmapi|downloads|operational\.db(-wal|-shm)?$/.test(e))).toEqual([]);
    expect(fs.existsSync(file('data/operational.db.bak'))).toBe(false);
  });
});

describe('restore (staged, then applied at boot)', () => {
  it('round-trips: stage validates, boot swaps DB, data and config, then cleans up', async () => {
    write('config.json', '{"v":"backup"}');
    write('data/wiki/page.md', 'old wiki');
    write('openclaw-config/openclaw.json', 'backup');
    const name = await BackupService.createBackup();

    // Life goes on after the backup
    write('config.json', '{"v":"current"}');
    write('data/wiki/page.md', 'new wiki');
    write('data/wiki/extra.md', 'extra');
    write('openclaw-config/openclaw.json', 'current');
    const live = liveDb('current');

    const staged = await BackupService.restoreBackup(name);
    expect(staged.restarting).toBe(false);
    expect(BackupService.getRestoreStatus().pending).toEqual({ filename: name, attempts: 0 });
    expect(read('config.json')).toBe('{"v":"current"}'); // nothing live touched yet
    live.close();
    write('data/operational.db-wal', 'stale wal'); // must never be replayed on the restored DB

    expect(applyPendingRestore(paths)).toEqual({ ok: true });

    expect(markerLabels()).toEqual(['backup']);
    expect(fs.existsSync(file('data/operational.db-wal'))).toBe(false);
    expect(read('config.json')).toBe('{"v":"backup"}');
    expect(read('data/wiki/page.md')).toBe('old wiki');
    expect(fs.existsSync(file('data/wiki/extra.md'))).toBe(false);
    expect(read('openclaw-config/openclaw.json')).toBe('backup');
    expect(fs.existsSync(path.join(paths.backupDir, RESTORE_STAGING))).toBe(false);
    expect(BackupService.getRestoreStatus()).toMatchObject({ pending: null, last: { ok: true, filename: name } });
    // Previous files are kept aside
    const rollback = fs.readdirSync(paths.dataDir).find(e => e.startsWith('.restore-rollback-'))!;
    expect(fs.readFileSync(path.join(paths.dataDir, rollback, 'wiki', 'page.md'), 'utf-8')).toBe('new wiki');
  });

  it('rolls everything back when a step fails', async () => {
    write('data/wiki/page.md', 'old wiki');
    write('openclaw-config/openclaw.json', 'backup');
    const name = await BackupService.createBackup();
    await BackupService.restoreBackup(name);

    write('config.json', '{"v":"current"}');
    write('data/wiki/page.md', 'new wiki');
    liveDb('current').close();
    fs.rmSync(file('openclaw-config'), { recursive: true });
    write('openclaw-config', 'a file where a directory is expected'); // fails the last step

    const result = applyPendingRestore(paths);

    expect(result?.ok).toBe(false);
    expect(markerLabels()).toEqual(['current']);
    expect(read('data/wiki/page.md')).toBe('new wiki');
    expect(read('config.json')).toBe('{"v":"current"}');
    expect(BackupService.getRestoreStatus()).toMatchObject({ pending: null, last: { ok: false, filename: name } });
    expect(fs.readdirSync(paths.backupDir).some(e => e.startsWith('restore-failed-'))).toBe(true);
  });

  it('gives up after two attempts instead of looping under restart: always', () => {
    fs.mkdirSync(path.join(paths.backupDir, RESTORE_STAGING));
    fs.writeFileSync(path.join(paths.backupDir, RESTORE_MARKER), JSON.stringify({ filename: 'b.tar.gz', dbRel: 'data/operational.db.bak', attempts: 2 }));

    expect(applyPendingRestore(paths)).toMatchObject({ ok: false, error: expect.stringContaining('2 attempts') });
    expect(fs.existsSync(path.join(paths.backupDir, RESTORE_MARKER))).toBe(false);
  });

  it('does nothing without a marker, and drops a half-staged directory', () => {
    fs.mkdirSync(path.join(paths.backupDir, RESTORE_STAGING));
    expect(applyPendingRestore(paths)).toBeNull();
    expect(fs.existsSync(path.join(paths.backupDir, RESTORE_STAGING))).toBe(false);
    expect(fs.existsSync(path.join(paths.backupDir, LAST_RESTORE))).toBe(false);
  });

  it('turns the live DB of very old backups into a snapshot', async () => {
    const name = archive('backup-old.tar.gz', dir => {
      fs.mkdirSync(path.join(dir, 'data'));
      const old = new Database(path.join(dir, 'data', 'operational.db'));
      old.exec(`CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('old')`);
      old.close();
    });
    await BackupService.restoreBackup(name);
    liveDb('current').close();

    expect(applyPendingRestore(paths)).toEqual({ ok: true });
    expect(markerLabels()).toEqual(['old']);
  });

  it('rejects unsafe, unusable or newer backups without staging anything', async () => {
    const withLink = archive('backup-link.tar.gz', dir => {
      fs.mkdirSync(path.join(dir, 'data'));
      fs.symlinkSync('/etc/passwd', path.join(dir, 'data', 'operational.db.bak'));
    });
    const noDb = archive('backup-nodb.tar.gz', dir => fs.writeFileSync(path.join(dir, 'config.json'), '{}'));
    const newer = archive('backup-newer.tar.gz', dir => {
      fs.mkdirSync(path.join(dir, 'data'));
      const future = new Database(path.join(dir, 'data', 'operational.db.bak'));
      future.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
      future.close();
    });

    await expect(BackupService.restoreBackup(withLink)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('Links') });
    await expect(BackupService.restoreBackup(noDb)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('no database') });
    await expect(BackupService.restoreBackup(newer)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('newer') });
    await expect(BackupService.restoreBackup('backup-missing.tar.gz')).rejects.toMatchObject({ statusCode: 404 });
    expect(fs.existsSync(path.join(paths.backupDir, RESTORE_MARKER))).toBe(false);
    expect(fs.existsSync(path.join(paths.backupDir, RESTORE_STAGING))).toBe(false);
  });

  it('refuses a second restore while one is pending', async () => {
    const name = await BackupService.createBackup();
    await BackupService.restoreBackup(name);
    await expect(BackupService.restoreBackup(name)).rejects.toMatchObject({ statusCode: 409 });
  });
});
