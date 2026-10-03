import { config } from '../config';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { Logger } from '../utils/Logger';
import db, { closeDB } from '../db/sqlite';
import { LATEST_SCHEMA_VERSION } from '../db/migrations';
import { defaultRestorePaths, LAST_RESTORE, RESTORE_MARKER, RESTORE_STAGING, RestoreMarker, RestorePaths } from '../db/restore';
import { InferenceRouter } from './InferenceRouter';

const execFileAsync = promisify(execFile);

/** Exit code that asks the supervisor (Docker `restart: always`, pm2) to start the server again */
export const RESTART_EXIT_CODE = 75;

const SNAPSHOT_REL = 'data/operational.db.bak';
const LIVE_DB_REL = 'data/operational.db';

// Neo4j and FreeLLMAPI belong to other containers (live files, backed up separately);
// release downloads must match the APKs on disk; live DB files are replaced by the snapshot.
const ARCHIVE_EXCLUDES = [
  'data/neo4j', 'data/freellmapi', 'data/downloads', 'data/.restore-rollback-*',
  LIVE_DB_REL, `${LIVE_DB_REL}-wal`, `${LIVE_DB_REL}-shm`,
  'openclaw-config/tools/sherpa-onnx-tts/models', '*.onnx', '*.gguf', '*.bin', '*.tflite',
];
const ARCHIVE_ENTRIES = ['config.json', 'data', 'firebase-service-account.json', 'openclaw-config'];
const EXTRACT_EXCLUDES = ['data/neo4j', 'data/freellmapi', 'data/downloads'];

function httpError(message: string, statusCode: number) {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export class BackupService {
  /** Overridable by tests; the real root is the server directory (/app in Docker) */
  public static paths: RestorePaths = defaultRestorePaths(path.resolve(__dirname, '../..'));

  /**
   * Resolves a client-supplied backup name inside the backup dir, rejecting path traversal.
   */
  private static safeBackupPath(filename: string): string {
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !/^[\w.-]+\.tar\.gz$/.test(filename)) {
      throw httpError('Invalid backup filename', 400);
    }
    return path.join(this.paths.backupDir, filename);
  }

  public static async init() {
    fs.mkdirSync(this.paths.backupDir, { recursive: true });
  }

  public static async listBackups() {
    await this.init();
    const files = fs.readdirSync(this.paths.backupDir);
    return files
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => {
        const stats = fs.statSync(path.join(this.paths.backupDir, f));
        return {
          filename: f,
          size: stats.size,
          createdAt: stats.mtimeMs
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  public static async createBackup(): Promise<string> {
    await this.init();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.tar.gz`;
    const targetPath = path.join(this.paths.backupDir, filename);
    const snapshot = path.join(this.paths.appRoot, SNAPSHOT_REL);

    Logger.info('BackupService', `Creating backup: ${filename}...`);

    try {
      // 1. Engage emergency brake
      InferenceRouter.setBrake(true);

      // 2. Consistent SQLite snapshot (the live file may have pages only in the WAL)
      fs.rmSync(snapshot, { force: true });
      db.prepare(`VACUUM INTO ?`).run(snapshot);

      // 3. Archive. Optional entries (Firebase key, openclaw-config) are skipped when absent.
      const entries = ARCHIVE_ENTRIES.filter(e => fs.existsSync(path.join(this.paths.appRoot, e)));
      await execFileAsync('tar', [
        '-czf', targetPath, '-C', this.paths.appRoot,
        ...ARCHIVE_EXCLUDES.map(pattern => `--exclude=${pattern}`),
        ...entries,
      ]);

      Logger.info('BackupService', `Backup created successfully: ${filename}`);

      // 4. Enforce retention
      await this.enforceRetention();

      return filename;
    } catch (err: any) {
      fs.rmSync(targetPath, { force: true });
      Logger.error('BackupService', `Backup failed: ${err.message}`);
      throw err;
    } finally {
      fs.rmSync(snapshot, { force: true });
      // 5. Disengage emergency brake
      try {
        InferenceRouter.setBrake(false);
      } catch (brakeErr: any) {
        Logger.error('BackupService', `Failed to release emergency brake: ${brakeErr.message}`);
      }
    }
  }

  /** Rejects archives with links, special files, absolute paths or `..` components. */
  private static async checkArchive(filePath: string) {
    const { stdout: names } = await execFileAsync('tar', ['-tzf', filePath], { maxBuffer: 64 * 1024 * 1024 });
    for (const name of names.split('\n').filter(Boolean)) {
      if (path.isAbsolute(name) || name.split('/').includes('..')) throw httpError(`Unsafe path in archive: ${name}`, 400);
    }
    const { stdout: listing } = await execFileAsync('tar', ['-tzvf', filePath], { maxBuffer: 64 * 1024 * 1024 });
    for (const line of listing.split('\n').filter(Boolean)) {
      if (line[0] !== '-' && line[0] !== 'd') throw httpError(`Links and special files are not allowed in a backup: ${line}`, 400);
    }
  }

  /** Checks the staged database: integrity, and a schema this server can migrate. */
  private static validateSnapshot(file: string) {
    const snapshot = new Database(file, { readonly: true, fileMustExist: true });
    try {
      const check = snapshot.pragma('quick_check', { simple: true });
      if (check !== 'ok') throw httpError(`Backup database is corrupted: ${check}`, 400);
      const version = snapshot.pragma('user_version', { simple: true }) as number;
      if (version > LATEST_SCHEMA_VERSION) {
        throw httpError(`Backup schema v${version} is newer than this server (v${LATEST_SCHEMA_VERSION})`, 400);
      }
    } finally {
      snapshot.close();
    }
  }

  /**
   * Stages a restore: the archive is checked, extracted and validated, then a marker is
   * written. Nothing live is touched: restoreAtBoot.ts applies it at the next start.
   */
  public static async restoreBackup(filename: string): Promise<{ restarting: boolean; message: string }> {
    const filePath = this.safeBackupPath(filename);
    if (!fs.existsSync(filePath)) throw httpError('Backup file not found', 404);
    const markerFile = path.join(this.paths.backupDir, RESTORE_MARKER);
    if (fs.existsSync(markerFile)) throw httpError('A restore is already waiting for the server restart', 409);

    Logger.info('BackupService', `Staging restore of ${filename}...`);
    const staging = path.join(this.paths.backupDir, RESTORE_STAGING);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });

    try {
      await this.checkArchive(filePath);
      await execFileAsync('tar', [
        '-xzf', filePath, '-C', staging, '--no-same-owner', '--no-same-permissions',
        ...EXTRACT_EXCLUDES.map(pattern => `--exclude=${pattern}`),
      ]);

      // Backups always carried the VACUUM INTO snapshot; very old ones may only have the live file
      const snapshot = path.join(staging, SNAPSHOT_REL);
      const liveCopy = path.join(staging, LIVE_DB_REL);
      if (!fs.existsSync(snapshot)) {
        if (!fs.existsSync(liveCopy)) throw httpError('The backup contains no database', 400);
        const source = new Database(liveCopy, { fileMustExist: true }); // replays its -wal, if any
        try { source.prepare('VACUUM INTO ?').run(snapshot); } finally { source.close(); }
      }
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${liveCopy}${suffix}`, { force: true });
      this.validateSnapshot(snapshot);

      const marker: RestoreMarker = { filename, dbRel: SNAPSHOT_REL, attempts: 0 };
      fs.writeFileSync(markerFile, JSON.stringify(marker, null, 2));
    } catch (err: any) {
      fs.rmSync(staging, { recursive: true, force: true });
      Logger.error('BackupService', `Restore of ${filename} not staged: ${err.message}`);
      throw err;
    }

    const restarting = this.isSupervised();
    Logger.info('BackupService', `Restore of ${filename} staged, ${restarting ? 'restarting' : 'waiting for a manual restart'}`);
    return {
      restarting,
      message: restarting
        ? 'Restore staged: the server is restarting to apply it.'
        : 'Restore staged: restart the server to apply it.',
    };
  }

  /** Docker (`restart: always`) and pm2 bring the process back after an exit. */
  public static isSupervised(): boolean {
    return fs.existsSync('/.dockerenv') || process.env.pm_id !== undefined;
  }

  /** Called once the restore response has been sent. */
  public static exitForRestore() {
    Logger.warn('BackupService', 'Exiting to apply the staged restore');
    try { InferenceRouter.setBrake(true); } catch { /* exiting anyway */ }
    setTimeout(() => {
      closeDB();
      process.exit(RESTART_EXIT_CODE);
    }, 500).unref();
  }

  /** Pending restore (if any) and the outcome of the last one applied at boot. */
  public static getRestoreStatus() {
    const readJson = (file: string) => {
      try { return JSON.parse(fs.readFileSync(path.join(this.paths.backupDir, file), 'utf-8')); } catch { return null; }
    };
    const marker = readJson(RESTORE_MARKER) as RestoreMarker | null;
    return {
      pending: marker ? { filename: marker.filename, attempts: marker.attempts } : null,
      last: readJson(LAST_RESTORE) as { ok: boolean; error?: string; filename: string; at: number } | null,
    };
  }

  public static async deleteBackup(filename: string): Promise<void> {
    const filePath = this.safeBackupPath(filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      Logger.info('BackupService', `Backup deleted: ${filename}`);
    }
  }

  public static getBackupPath(filename: string): string {
    return this.safeBackupPath(filename);
  }

  private static async enforceRetention() {
    try {
      const maxRetention = (config as any).backup?.maxRetention || 5;
      const backups = await this.listBackups();

      if (backups.length > maxRetention) {
        const toDelete = backups.slice(maxRetention);
        Logger.info('BackupService', `Retention policy: deleting ${toDelete.length} old backup(s) (Limit: ${maxRetention})`);

        for (const b of toDelete) {
          await this.deleteBackup(b.filename);
        }
      }
    } catch (err: any) {
      Logger.error('BackupService', `Failed to enforce retention: ${err.message}`);
    }
  }
}
