import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../../logger';
import { DatabaseManager } from '../../database/DatabaseManager';
import { migrateTasksTable } from '../tasks/taskSchema';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  location TEXT,
  notes TEXT,
  is_all_day INTEGER DEFAULT 0,
  is_recurring INTEGER DEFAULT 0,
  recurrence_rule TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_end ON calendar_events(end_time);

CREATE TABLE IF NOT EXISTS calendar_notes (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_date ON calendar_notes(date);
CREATE INDEX IF NOT EXISTS idx_notes_category ON calendar_notes(category);
`;

let isSchemaApplied = false;

/**
 * Initialize the SQLite connection and database schemas
 */
export async function initCalendarDatabase(): Promise<SQLiteDBConnection> {
    const db = await DatabaseManager.getInstance().getDatabase('calendar');

    if (isSchemaApplied) {
        return db;
    }

    try {
        // Create schema
        const schemaStatements = SCHEMA.split(';').filter(stmt => stmt.trim().length > 0);
        for (const stmt of schemaStatements) {
            if (stmt.trim()) {
                await db.execute(stmt);
            }
        }
        logger.log('info', '[CalendarDB] Schema created');

        // Ensure task tables are created 
        try {
            await migrateTasksTable(db);
        } catch (taskErr) {
            logger.log('error', '[CalendarDB] Failed to run task migration during init', taskErr);
        }

        isSchemaApplied = true;
        return db;
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to initialize schema', error);
        throw error;
    }
}

/**
 * Get the database connection (Robust Proxy via Manager)
 */
export async function getCalendarDatabase(_forceCheck: boolean = false): Promise<SQLiteDBConnection> {
    // Ensure schema is applied
    if (!isSchemaApplied) {
        try {
            return await initCalendarDatabase();
        } catch (e) {
            logger.log('error', '[CalendarDB] Failed to init schema on get', e);
            // Fallback to just getting the DB from manager
            return DatabaseManager.getInstance().getDatabase('calendar');
        }
    }
    return DatabaseManager.getInstance().getDatabase('calendar');
}

/**
 * Reopen database connection (called on app resume)
 */
export async function reopenCalendarDatabase(): Promise<void> {
    try {
        logger.log('info', '[CalendarDB] Reopening database request (handled by Manager)');
        await getCalendarDatabase();
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to reopen database', error);
    }
}

/**
 * Close the database connection
 */
export async function closeCalendarDatabase(): Promise<void> {
    logger.log('info', '[CalendarDB] Close request ignored (managed centrally)');
}
