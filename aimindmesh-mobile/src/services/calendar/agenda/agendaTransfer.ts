import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';
import { parseTaskRow } from '../tasks/taskHelpers';
import { CalendarTask } from '../../../types/calendar';

/** Every column of calendar_tasks, in the order of taskValues() */
const TASK_COLUMNS = [
    'id', 'title', 'description', 'status', 'priority', 'created_at', 'due_date', 'completed_at',
    'category', 'tags', 'assigned_to', 'estimated_hours', 'actual_hours', 'parent_task_id',
    'linked_event_id', 'recurrence_rule', 'recurrence_parent_id', 'color', 'task_order',
    'pomodoro_count', 'pomodoro_target', 'assignee', 'ai_config'
];

function taskValues(t: CalendarTask): unknown[] {
    return [
        t.id, t.title, t.description || '', t.status, t.priority, t.createdAt, t.dueDate, t.completedAt ?? null,
        t.category ?? null, JSON.stringify(t.tags || []), t.assignedTo ?? null, t.estimatedHours ?? null,
        t.actualHours ?? null, t.parentTaskId ?? null, t.linkedEventId ?? null,
        t.recurrenceRule ? JSON.stringify(t.recurrenceRule) : null, t.recurrenceParentId ?? null,
        t.color ?? null, t.order ?? 0, t.pomodoroCount ?? 0, t.pomodoroTarget ?? null,
        t.assignee || 'user', t.aiConfig ? JSON.stringify(t.aiConfig) : null
    ];
}

/**
 * Export all agenda data as JSON
 */
export async function exportAgendaData(): Promise<string> {
    const database = await getCalendarDatabase();

    try {
        const eventsResult = await database.query('SELECT * FROM calendar_events ORDER BY start_time');
        const notesResult = await database.query('SELECT * FROM calendar_notes ORDER BY date');
        // The Kanban tasks live in the same database: a backup without them loses them
        const tasksResult = await database.query('SELECT * FROM calendar_tasks ORDER BY created_at');

        const events = (eventsResult.values || []).map((row: any) => ({
            id: row.id,
            title: row.title,
            startTime: row.start_time,
            endTime: row.end_time,
            location: row.location,
            notes: row.notes,
            isAllDay: row.is_all_day === 1,
            isRecurring: row.is_recurring === 1,
            recurrenceRule: row.recurrence_rule,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        const notes = (notesResult.values || []).map((row: any) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        return JSON.stringify({
            version: 2,
            exportedAt: new Date().toISOString(),
            events,
            notes,
            tasks: (tasksResult.values || []).map(parseTaskRow)
        }, null, 2);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to export agenda data', error);
        throw error;
    }
}

/**
 * Import agenda data from JSON
 */
export async function importAgendaData(jsonData: string, overwrite: boolean = false): Promise<{ eventsImported: number; notesImported: number; tasksImported: number }> {
    const database = await getCalendarDatabase();

    try {
        const data = JSON.parse(jsonData);

        if (!data.events || !data.notes) {
            throw new Error('Invalid agenda data format');
        }

        if (overwrite) {
            await database.run('DELETE FROM calendar_events');
            await database.run('DELETE FROM calendar_notes');
            // Only a backup that has tasks replaces them (version 1 files have none)
            if (Array.isArray(data.tasks)) await database.run('DELETE FROM calendar_tasks');
        }

        let eventsImported = 0;
        let notesImported = 0;

        // Import events
        for (const event of data.events) {
            try {
                await database.run(
                    `INSERT OR REPLACE INTO calendar_events 
           (id, title, start_time, end_time, location, notes, is_all_day, is_recurring, recurrence_rule, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        event.id,
                        event.title,
                        event.startTime,
                        event.endTime,
                        event.location || null,
                        event.notes || null,
                        event.isAllDay ? 1 : 0,
                        event.isRecurring ? 1 : 0,
                        event.recurrenceRule || null,
                        event.createdAt,
                        event.updatedAt
                    ]
                );
                eventsImported++;
            } catch (e) {
                logger.log('warn', `[CalendarDB] Failed to import event: ${event.id}`, e);
            }
        }

        // Import notes
        for (const note of data.notes) {
            try {
                await database.run(
                    `INSERT OR REPLACE INTO calendar_notes (id, date, content, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [note.id, note.date, note.content, note.category, note.createdAt, note.updatedAt]
                );
                notesImported++;
            } catch (e) {
                logger.log('warn', `[CalendarDB] Failed to import note: ${note.id}`, e);
            }
        }

        // Tasks (version 2+ backups). Parents before subtasks, for the parent_task_id reference
        let tasksImported = 0;
        const tasks: CalendarTask[] = Array.isArray(data.tasks) ? data.tasks : [];
        tasks.sort((a, b) => Number(!!a.parentTaskId) - Number(!!b.parentTaskId));
        for (const task of tasks) {
            try {
                await database.run(
                    `INSERT OR REPLACE INTO calendar_tasks (${TASK_COLUMNS.join(', ')})
           VALUES (${TASK_COLUMNS.map(() => '?').join(', ')})`,
                    taskValues(task)
                );
                tasksImported++;
            } catch (e) {
                logger.log('warn', `[CalendarDB] Failed to import task: ${task.id}`, e);
            }
        }

        logger.log('info', `[CalendarDB] Imported ${eventsImported} events, ${notesImported} notes and ${tasksImported} tasks`);
        return { eventsImported, notesImported, tasksImported };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to import agenda data', error);
        throw error;
    }
}
