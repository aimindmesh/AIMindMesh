import { config } from '../config';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/Logger';
import db, { closeDB, reopenDB } from '../db/sqlite';
import { WikiManager } from './WikiManager';
import { InferenceRouter } from './InferenceRouter';

const execAsync = promisify(exec);

export class BackupService {
  private static readonly BACKUP_DIR = path.join(__dirname, '../../backups');

  public static async init() {
    if (!fs.existsSync(this.BACKUP_DIR)) {
      fs.mkdirSync(this.BACKUP_DIR, { recursive: true });
    }
  }

  public static async listBackups() {
    await this.init();
    const files = fs.readdirSync(this.BACKUP_DIR);
    return files
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => {
        const stats = fs.statSync(path.join(this.BACKUP_DIR, f));
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
    const targetPath = path.join(this.BACKUP_DIR, filename);

    Logger.info('BackupService', `Creating backup: ${filename}...`);

    try {
      // 1. Engage emergency brake
      InferenceRouter.setBrake(true);

      // 2. Create a consistent SQLite snapshot using VACUUM INTO
      const sqliteBackupPath = path.join(__dirname, '../../data/operational.db.bak');
      if (fs.existsSync(sqliteBackupPath)) fs.unlinkSync(sqliteBackupPath);
      
      Logger.debug('BackupService', 'Creating SQLite snapshot via VACUUM INTO...');
      db.prepare(`VACUUM INTO ?`).run(sqliteBackupPath);

      // 3. Create archive
      // Include: config, firebase credentials, all data (SQLite bak, Neo4j, Wiki, downloads), and OpenClaw config
      // Exclude: Large static models and their file extensions to keep backup size manageable
      const cmd = `tar -czf ${targetPath} -C /app --exclude='data/downloads/models' --exclude='openclaw-config/tools/sherpa-onnx-tts/models' --exclude='*.onnx' --exclude='*.gguf' --exclude='*.bin' --exclude='*.tflite' config.json data/ firebase-service-account.json openclaw-config/ 2>/dev/null || tar -czf ${targetPath} -C /app config.json data/`;
      
      await execAsync(cmd);
      
      // Cleanup snapshot
      if (fs.existsSync(sqliteBackupPath)) fs.unlinkSync(sqliteBackupPath);

      Logger.info('BackupService', `Backup created successfully: ${filename}`);
      
      // 4. Enforce retention
      await this.enforceRetention();

      return filename;
    } catch (err: any) {
      Logger.error('BackupService', `Backup failed: ${err.message}`);
      throw err;
    } finally {
      // 5. Disengage emergency brake
      try {
        InferenceRouter.setBrake(false);
      } catch (brakeErr: any) {
        Logger.error('BackupService', `Failed to release emergency brake: ${brakeErr.message}`);
      }
    }
  }

  public static async restoreBackup(filename: string): Promise<void> {
    const filePath = path.join(this.BACKUP_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('Backup file not found');
    }

    Logger.info('BackupService', `Restoring backup: ${filename}...`);

    try {
      // 1. Extract to temporary location
      const tempDir = path.join(this.BACKUP_DIR, 'temp_restore');
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tempDir, { recursive: true });

      await execAsync(`tar -xzf ${filePath} -C ${tempDir}`);

      // 2. Atomic-ish swap
      // We close the DB connection to allow file replacement
      Logger.debug('BackupService', 'Closing database connection for restoration...');
      closeDB();

      const items = fs.readdirSync(tempDir);
      for (const item of items) {
        const source = path.join(tempDir, item);
        const dest = path.join('/app', item);
        
        if (fs.lstatSync(source).isDirectory()) {
            Logger.debug('BackupService', `Restoring directory: ${item}`);
            await execAsync(`cp -rf ${source}/. ${dest}/`);
        } else {
            Logger.debug('BackupService', `Restoring file: ${item}`);
            fs.copyFileSync(source, dest);
        }
      }

      // 3. Re-open DB and re-init services
      reopenDB();
      
      // Re-init WikiManager to pick up restored files
      await WikiManager.init(
        config.wiki?.storagePath ?? './data/wiki',
        config.wiki?.gitEnabled ?? false
      );

      Logger.info('BackupService', `Restore successful. Operational DB re-opened and Wiki re-indexed.`);
      
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });

    } catch (err: any) {
      Logger.error('BackupService', `Restore failed: ${err.message}`);
      throw err;
    }
  }

  public static async deleteBackup(filename: string): Promise<void> {
    const filePath = path.join(this.BACKUP_DIR, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      Logger.info('BackupService', `Backup deleted: ${filename}`);
    }
  }

  public static getBackupPath(filename: string): string {
    return path.join(this.BACKUP_DIR, filename);
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
