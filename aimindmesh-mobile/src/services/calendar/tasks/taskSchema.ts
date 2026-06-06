import { logger } from '../../logger';
import { getCalendarDatabase } from '../calendarDatabase';

export const TASK_SCHEMA = `
CREATE TABLE IF NOT EXISTS calendar_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' 
        CHECK(status IN ('backlog', 'todo', 'in-progress', 'review', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
    created_at INTEGER NOT NULL,
    due_date INTEGER NOT NULL,
    completed_at INTEGER,
    category TEXT,
    tags TEXT,
    assigned_to TEXT,
    estimated_hours REAL,
    actual_hours REAL,
    parent_task_id TEXT,
    linked_event_id TEXT,
    recurrence_rule TEXT,
    recurrence_parent_id TEXT,
    color TEXT,
    task_order INTEGER DEFAULT 0,
    pomodoro_count INTEGER DEFAULT 0,
    pomodoro_target INTEGER,
    FOREIGN KEY (linked_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_task_id) REFERENCES calendar_tasks(id) ON DELETE CASCADE
);
`;

export const TASK_INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON calendar_tasks(due_date);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_status ON calendar_tasks(status);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_priority ON calendar_tasks(priority, due_date);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_parent ON calendar_tasks(parent_task_id);',
    'CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON calendar_tasks(recurrence_parent_id);'
];

import { SQLiteDBConnection } from '@capacitor-community/sqlite';

/**
 * Migrate database to include tasks table
 */
export async function migrateTasksTable(dbInstance?: SQLiteDBConnection): Promise<void> {
    const db = dbInstance || await getCalendarDatabase();

    try {
        // Check if migration needed
        const result = await db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_tasks'"
        );

        if (result.values && result.values.length > 0) {
            logger.log('info', '[TaskDB] Tasks table already exists, skipping migration');
            return;
        }

        logger.log('info', '[TaskDB] Creating calendar_tasks table...');

        // Create table
        await db.execute(TASK_SCHEMA);

        // Create indexes
        for (const indexSql of TASK_INDEXES) {
            await db.execute(indexSql);
        }

        logger.log('info', '[TaskDB] Migration complete - calendar_tasks table created');
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to migrate tasks table', error);
        throw error;
    }

    // ─── AI Delegation Migration ───────────────────────────────────────────────────
    try {
        const columnsToAdd = [
            { name: 'assignee',        definition: "TEXT NOT NULL DEFAULT 'user'" },
            { name: 'ai_config',       definition: 'TEXT' },
            { name: 'server_task_id',  definition: 'TEXT' },
        ];

        for (const col of columnsToAdd) {
            try {
                await db.execute(`ALTER TABLE calendar_tasks ADD COLUMN ${col.name} ${col.definition}`);
                logger.log('info', `[TaskDB] Column added: ${col.name}`);
            } catch (e: any) {
                if (!e.message?.includes('duplicate column')) {
                    logger.log('error', `[TaskDB] ALTER TABLE error for ${col.name}: ${e.message}`);
                }
            }
        }
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to run AI task migration', error);
    }
}
