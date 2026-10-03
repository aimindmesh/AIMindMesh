/**
 * Task Recurrence Service
 * Handles generation of recurring task occurrences
 *
 * A series is its root task (the one carrying the rule, without recurrence_parent_id) plus the
 * occurrences generated from it, all linked to the root. The series always keeps one open
 * occurrence: the next one is created when the latest is completed or its due date passes.
 */

import { logger } from '../logger';
import { getCalendarDatabase } from './calendarDatabase';
import { CalendarTask, RecurrenceRule } from '../../types/calendar';
import { createTask } from './tasks/taskOperations';
import { parseTaskRow } from './tasks/taskHelpers';

/** Upper bound of the catch-up loop (a daily rule missed for years, or a corrupted rule) */
const MAX_STEPS = 10_000;

/**
 * Calculate the next due date based on recurrence rule
 */
function calculateNextDueDate(lastDueDate: Date, rule: RecurrenceRule): Date {
    const nextDate = new Date(lastDueDate);
    // An interval of 0 (or a missing one) would never advance
    const interval = Math.max(1, Math.floor(rule.interval || 1));

    switch (rule.type) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + interval);
            break;

        case 'weekly':
            nextDate.setDate(nextDate.getDate() + (7 * interval));
            break;

        case 'monthly':
            nextDate.setMonth(nextDate.getMonth() + interval);
            break;

        default:
            return nextDate;
    }

    return nextDate;
}

/**
 * Due date of the occurrence after one due at `lastDue`: the first step of the rule after
 * `now` (missed occurrences are skipped, not created as a pile of overdue tasks), or null
 * when the rule has ended or cannot advance.
 */
export function nextOccurrenceDue(lastDue: number, rule: RecurrenceRule, now: number): number | null {
    let next = calculateNextDueDate(new Date(lastDue), rule).getTime();
    for (let steps = 0; next <= now && steps < MAX_STEPS; steps++) {
        next = calculateNextDueDate(new Date(next), rule).getTime();
    }
    if (!Number.isFinite(next) || next <= lastDue || next <= now) return null;
    if (rule.endDate && next > rule.endDate) return null;
    return next;
}

/**
 * Whether a series needs its next occurrence: its latest one is done or already past due.
 */
export function needsNextOccurrence(latest: Pick<CalendarTask, 'status' | 'dueDate'>, now: number): boolean {
    return latest.status === 'done' || latest.dueDate < now;
}

/**
 * Generate the next occurrence of the series that `task` belongs to
 */
export async function generateNextOccurrence(
    parentTask: CalendarTask,
    now: number = Date.now()
): Promise<CalendarTask | null> {
    if (!parentTask.recurrenceRule) {
        return null;
    }

    const nextDueDate = nextOccurrenceDue(parentTask.dueDate, parentTask.recurrenceRule, now);
    if (nextDueDate === null) {
        logger.log('info', '[Recurrence] End date reached, stopping generation');
        return null;
    }

    try {
        // Create new task instance
        const newTask = await createTask({
            title: parentTask.title,
            description: parentTask.description,
            status: 'todo',
            priority: parentTask.priority,
            dueDate: nextDueDate,
            category: parentTask.category,
            tags: parentTask.tags,
            estimatedHours: parentTask.estimatedHours,
            recurrenceRule: parentTask.recurrenceRule,
            // Always the root: the series is found by it
            recurrenceParentId: parentTask.recurrenceParentId || parentTask.id,
            color: parentTask.color,
            pomodoroTarget: parentTask.pomodoroTarget
        });

        logger.log('info', `[Recurrence] Generated next occurrence: ${newTask.id}`);
        return newTask;
    } catch (error) {
        logger.log('error', '[Recurrence] Failed to generate occurrence', error);
        return null;
    }
}

/**
 * Latest occurrence (by due date) of the series rooted at `rootId`, the root included
 */
async function getLatestOccurrence(rootId: string): Promise<CalendarTask | null> {
    const db = await getCalendarDatabase();
    const result = await db.query(
        `SELECT * FROM calendar_tasks
         WHERE id = ? OR recurrence_parent_id = ?
         ORDER BY due_date DESC
         LIMIT 1`,
        [rootId, rootId]
    );
    return result.values?.[0] ? parseTaskRow(result.values[0]) : null;
}

/**
 * Creates the next occurrence of one series when its latest occurrence is done or past due.
 * Called when a recurring task is completed.
 */
export async function ensureNextOccurrence(task: CalendarTask, now: number = Date.now()): Promise<CalendarTask | null> {
    if (!task.recurrenceRule) return null;
    const latest = await getLatestOccurrence(task.recurrenceParentId || task.id);
    if (!latest || !needsNextOccurrence(latest, now)) return null;
    return generateNextOccurrence(latest, now);
}

/**
 * Check and generate the next occurrence of every recurring series.
 * Called when the task board loads; completion is handled by ensureNextOccurrence.
 */
export async function generateUpcomingOccurrences(now: number = Date.now()): Promise<void> {
    const db = await getCalendarDatabase();

    try {
        // Find all recurring root tasks (those with recurrence rule but no parent)
        const result = await db.query(
            `SELECT * FROM calendar_tasks
             WHERE recurrence_rule IS NOT NULL
               AND recurrence_parent_id IS NULL
               AND parent_task_id IS NULL`
        );

        if (!result.values || result.values.length === 0) {
            return;
        }

        for (const row of result.values) {
            await ensureNextOccurrence(parseTaskRow(row), now);
        }

        logger.log('info', '[Recurrence] Upcoming occurrences generation complete');
    } catch (error) {
        logger.log('error', '[Recurrence] Failed to generate upcoming occurrences', error);
    }
}

/**
 * Delete all future occurrences of a recurring task
 */
export async function deleteRecurrenceSeries(parentTaskId: string): Promise<void> {
    const db = await getCalendarDatabase();

    try {
        await db.run(
            `DELETE FROM calendar_tasks
             WHERE recurrence_parent_id = ? AND due_date > ?`,
            [parentTaskId, Date.now()]
        );

        logger.log('info', `[Recurrence] Deleted future occurrences for: ${parentTaskId}`);
    } catch (error) {
        logger.log('error', '[Recurrence] Failed to delete recurrence series', error);
        throw error;
    }
}

/**
 * Get all tasks in a recurrence series
 */
export async function getRecurrenceSeries(parentTaskId: string): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks
             WHERE recurrence_parent_id = ? OR id = ?
             ORDER BY due_date ASC`,
            [parentTaskId, parentTaskId]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[Recurrence] Failed to get recurrence series', error);
        return [];
    }
}
