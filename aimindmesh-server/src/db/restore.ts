import fs from 'fs';
import path from 'path';

/**
 * Applies a backup restore staged by BackupService.restoreBackup().
 *
 * Run by restoreAtBoot.ts, the first import of index.ts: before config.ts reads config.json
 * and before sqlite.ts opens the database, so it only depends on fs/path and logs with console.
 *
 * Restoring at boot is the only safe way: every module holds the database handle opened
 * at import time, and the in-memory queues/schedulers would not match restored data.
 */

export const RESTORE_MARKER = '.restore-ready.json';
export const RESTORE_STAGING = 'restore-staging';
export const LAST_RESTORE = 'last-restore.json';
const MAX_ATTEMPTS = 2;

// Never restored: other containers' live stores, release downloads, the live DB files themselves
const SKIPPED_DATA_ENTRIES = new Set([
  'neo4j', 'freellmapi', 'downloads', 'operational.db', 'operational.db-wal', 'operational.db-shm', 'operational.db.bak',
]);

export interface RestorePaths {
  appRoot: string;
  dataDir: string;
  backupDir: string;
}

export interface RestoreMarker {
  filename: string;
  /** Database file inside the staging dir (relative), normally data/operational.db.bak */
  dbRel: string;
  attempts: number;
}

export function defaultRestorePaths(appRoot = path.resolve(__dirname, '../..')): RestorePaths {
  return { appRoot, dataDir: path.join(appRoot, 'data'), backupDir: path.join(appRoot, 'backups') };
}

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function fsyncFile(file: string) {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

/**
 * Applies the staged restore if a marker is present. Returns the outcome, or null if
 * there was nothing to do. On any error every completed step is undone.
 */
export function applyPendingRestore(paths: RestorePaths = defaultRestorePaths()): { ok: boolean; error?: string } | null {
  const markerFile = path.join(paths.backupDir, RESTORE_MARKER);
  const staging = path.join(paths.backupDir, RESTORE_STAGING);
  const lastFile = path.join(paths.backupDir, LAST_RESTORE);

  if (!fs.existsSync(markerFile)) {
    // Leftover of an interrupted staging: never apply it without a marker
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    return null;
  }

  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf-8')) as RestoreMarker;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const finish = (result: { ok: boolean; error?: string }) => {
    writeJson(lastFile, { ...result, filename: marker.filename, at: Date.now() });
    fs.rmSync(markerFile, { force: true });
    if (result.ok) fs.rmSync(staging, { recursive: true, force: true });
    else if (fs.existsSync(staging)) fs.renameSync(staging, path.join(paths.backupDir, `restore-failed-${stamp}`));
    return result;
  };

  // A restore that keeps crashing the server must not loop forever under `restart: always`
  if (marker.attempts >= MAX_ATTEMPTS) {
    console.error(`[Restore] Giving up on ${marker.filename} after ${marker.attempts} attempts`);
    return finish({ ok: false, error: `Restore abandoned after ${marker.attempts} attempts` });
  }
  writeJson(markerFile, { ...marker, attempts: marker.attempts + 1 });

  // Rollback copies live on the same mount as the originals (renames cannot cross mounts)
  const dataRollback = path.join(paths.dataDir, `.restore-rollback-${stamp}`);
  const confRollback = path.join(paths.backupDir, `restore-rollback-${stamp}`);
  fs.mkdirSync(dataRollback, { recursive: true });
  fs.mkdirSync(confRollback, { recursive: true });
  const undo: (() => void)[] = [];

  try {
    // 1. Database: the consistent snapshot replaces the live file. Old -wal/-shm must go,
    //    otherwise SQLite would replay the old WAL onto the restored database.
    const staged = path.join(staging, marker.dbRel);
    if (!fs.existsSync(staged)) throw new Error(`Staged database not found: ${marker.dbRel}`);
    const liveDb = path.join(paths.dataDir, 'operational.db');
    const incoming = `${liveDb}.restoring`;
    fs.copyFileSync(staged, incoming);
    fsyncFile(incoming);
    undo.push(() => fs.rmSync(incoming, { force: true }));
    for (const suffix of ['', '-wal', '-shm']) {
      const live = `${liveDb}${suffix}`;
      if (!fs.existsSync(live)) continue;
      const saved = path.join(dataRollback, `operational.db${suffix}`);
      fs.renameSync(live, saved);
      undo.push(() => fs.renameSync(saved, live));
    }
    fs.renameSync(incoming, liveDb);
    undo.push(() => fs.rmSync(liveDb, { force: true }));

    // 2. Other data (wiki, ...): whole entries are swapped
    const stagedData = path.join(staging, 'data');
    if (fs.existsSync(stagedData)) {
      for (const entry of fs.readdirSync(stagedData)) {
        if (SKIPPED_DATA_ENTRIES.has(entry) || entry.startsWith('.restore-rollback')) continue;
        const target = path.join(paths.dataDir, entry);
        if (fs.existsSync(target)) {
          const saved = path.join(dataRollback, entry);
          fs.renameSync(target, saved);
          undo.push(() => fs.renameSync(saved, target));
        }
        fs.cpSync(path.join(stagedData, entry), target, { recursive: true });
        undo.push(() => fs.rmSync(target, { recursive: true, force: true }));
      }
    }

    // 3. Single-file bind mounts (config.json, Firebase key): rewritten in place, never renamed
    for (const file of ['config.json', 'firebase-service-account.json']) {
      const source = path.join(staging, file);
      if (!fs.existsSync(source)) continue;
      const target = path.join(paths.appRoot, file);
      if (fs.existsSync(target)) {
        const saved = path.join(confRollback, file);
        fs.copyFileSync(target, saved);
        undo.push(() => fs.copyFileSync(saved, target));
      } else {
        undo.push(() => fs.rmSync(target, { force: true }));
      }
      fs.copyFileSync(source, target);
    }

    // 4. openclaw-config is a mounted directory: merge-overwrite file by file
    const stagedOpenclaw = path.join(staging, 'openclaw-config');
    if (fs.existsSync(stagedOpenclaw)) {
      for (const rel of listFiles(stagedOpenclaw)) {
        const target = path.join(paths.appRoot, 'openclaw-config', rel);
        if (fs.existsSync(target)) {
          const saved = path.join(confRollback, 'openclaw-config', rel);
          fs.mkdirSync(path.dirname(saved), { recursive: true });
          fs.copyFileSync(target, saved);
          undo.push(() => fs.copyFileSync(saved, target));
        } else {
          undo.push(() => fs.rmSync(target, { force: true }));
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(stagedOpenclaw, rel), target);
      }
      console.info('[Restore] openclaw-config restored: restart the openclaw-gateway container to reload it');
    }

    console.info(`[Restore] ${marker.filename} applied (previous files kept in ${dataRollback} and ${confRollback})`);
    return finish({ ok: true });
  } catch (err: any) {
    for (const step of undo.reverse()) {
      try { step(); } catch (undoErr: any) { console.error(`[Restore] Rollback step failed: ${undoErr.message}`); }
    }
    console.error(`[Restore] ${marker.filename} failed, previous data kept: ${err.message}`);
    return finish({ ok: false, error: err.message });
  }
}
