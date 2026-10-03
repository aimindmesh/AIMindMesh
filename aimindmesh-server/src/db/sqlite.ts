import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrations';

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// AIMINDMESH_DB_PATH lets tests use ':memory:' instead of the real operational database
const dbPath = process.env.AIMINDMESH_DB_PATH || path.join(dbDir, 'operational.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // safe with WAL, avoids an fsync per statement
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Schema is versioned (PRAGMA user_version): see migrations.ts. A failure stops the boot.
runMigrations(db);

/**
 * Closes the connection (shutdown, or right before exiting to apply a staged restore).
 * There is no reopen: the default export is a snapshot binding held by every module,
 * so a restore is applied at the next boot (see restoreAtBoot.ts).
 */
export function closeDB() {
  if (db.open) db.close();
}

export default db;
