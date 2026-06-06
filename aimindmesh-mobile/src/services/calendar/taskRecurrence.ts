/**
 * Task Recurrence Service
 * Handles generation of recurring task occurrences
 */

import { logger } from '../logger';
import { getCalendarDatabase } from './calendarDatabase';
import { CalendarTask, RecurrenceRule } from '../../types/calendar';
import { createTask } from './taskDatabase';

/**
 * Parse task row from database result
 */
function parseTaskRow(row: any): CalendarTask {
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at,
        dueDate: row.due_date,
        completedAt: row.completed_at || undefined,
        category: row.category || undefined,
        tags: row.tags ? JSON.parse(row.tags) : [],
        assignedTo: row.assigned_to || undefined,
        estimatedHours: row.estimated_hours || undefined,
        actualHours: row.actual_hours || undefined,
        parentTaskId: row.parent_task_id || undefined,
        linkedEventId: row.linked_event_id || undefined,
        recurrenceRule: row.recurrence_rule ? JSON.parse(row.recurrence_rule) : undefined,
        recurrenceParentId: row.recurrence_parent_id || undefined,
        color: row.color || undefined,
        order: row.task_order || 0,
        pomodoroCount: row.pomodoro_count || 0,
        pomodoroTarget: row.pomodoro_target || undefined
    };
}

/**
 * Calculate the next due date based on recurrence rule
 */
function calculateNextDueDate(lastDueDate: Date, rule: RecurrenceRule): Date {
    const nextDate = new Date(lastDueDate);

    switch (rule.type) {
        case 'daily':
            nextDate.setDate(nextDate.getDate() + rule.interval);
            break;

        case 'weekly':
            nextDate.setDate(nextDate.getDate() + (7 * rule.interval));
            break;

        case 'monthly':
            nextDate.setMonth(nextDate.getMonth() + rule.interval);
            break;

        default:
            return nextDate;
    }

    return nextDate;
}

/**
 * Generate the next occurrence for a recurring task
 */
export async function generateNextOccurrence(
    parentTask: CalendarTask
): Promise<CalendarTask | null> {
    if (!parentTask.recurrenceRule) {
        return null;
    }

    const rule = parentTask.recurrenceRule;
    const lastDueDate = new Date(parentTask.dueDate);
    const nextDueDate = calculateNextDueDate(lastDueDate, rule);

    // Check if past end date
    if (rule.endDate && nextDueDate.getTime() > rule.endDate) {
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
            dueDate: nextDueDate.getTime(),
            category: parentTask.category,
            tags: parentTask.tags,
            estimatedHours: parentTask.estimatedHours,
            recurrenceRule: parentTask.recurrenceRule,
            recurrenceParentId: parentTask.id,
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
 * Check and generate upcoming occurrences for all recurring tasks
 * Should be called periodically (e.g., daily or on app startup)
 */
export async function generateUpcomingOccurrences(daysAhead: number = 30): Promise<void> {
    const db = await getCalendarDatabase();

    try {
        // Find all recurring parent tasks (those with recurrence rule but no parent)
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE recurrence_rule IS NOT NULL 
               AND recurrence_parent_id IS NULL`
        );

        if (!result.values || result.values.length === 0) {
            logger.log('info', '[Recurrence] No recurring tasks found');
            return;
        }

        const now = Date.now();
        const futureLimit = now + (daysAhead * 24 * 60 * 60 * 1000);

        for (const row of result.values) {
            const parentTask = parseTaskRow(row);

            // Find the latest generated occurrence for this parent
            const latestResult = await db.query(
                `SELECT * FROM calendar_tasks 
                 WHERE recurrence_parent_id = ?
                 ORDER BY due_date DESC
                 LIMIT 1`,
                [parentTask.id]
            );

            let lastTask = latestResult.values?.[0]
                ? parseTaskRow(latestResult.values[0])
                : parentTask;

            // Generate occurrences until we reach the future limit
            while (lastTask.dueDate < futureLimit) {
                const nextTask = await generateNextOccurrence(lastTask);
                if (!nextTask) break; // End date reached or error
                lastTask = nextTask;
            }
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
