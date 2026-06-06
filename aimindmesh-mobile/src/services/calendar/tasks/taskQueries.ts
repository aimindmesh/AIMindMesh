import { logger } from '../../logger';
import { getCalendarDatabase } from '../calendarDatabase';
import { CalendarTask, TaskStatus, TaskStats, KanbanBoard } from '../../../types/calendar';
import { parseTaskRow } from './taskHelpers';

/**
 * Get tasks by status (for a single Kanban column)
 */
export async function getTasksByStatus(status: TaskStatus): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE status = ? AND parent_task_id IS NULL 
             ORDER BY task_order ASC, priority DESC, due_date ASC`,
            [status]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get tasks by status', error);
        return [];
    }
}

/**
 * Get full Kanban board data
 */
export async function getKanbanBoard(): Promise<KanbanBoard> {
    const statuses: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];
    const board: KanbanBoard = {
        backlog: [],
        todo: [],
        'in-progress': [],
        review: [],
        done: []
    };

    for (const status of statuses) {
        board[status] = await getTasksByStatus(status);
    }

    return board;
}

/**
 * Get tasks for a specific date
 */
export async function getTasksForDate(date: Date): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();
    const startOfDay = new Date(date).setHours(0, 0, 0, 0);
    const endOfDay = new Date(date).setHours(23, 59, 59, 999);

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE due_date >= ? AND due_date <= ?
             ORDER BY priority DESC, due_date ASC`,
            [startOfDay, endOfDay]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get tasks for date', error);
        return [];
    }
}

/**
 * Get overdue tasks
 */
export async function getOverdueTasks(): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();
    const now = Date.now();

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE due_date < ? AND status != 'done' AND parent_task_id IS NULL
             ORDER BY due_date ASC`,
            [now]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get overdue tasks', error);
        return [];
    }
}

/**
 * Get upcoming tasks within N days
 */
export async function getUpcomingTasks(days: number = 7): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();
    const now = Date.now();
    const future = now + (days * 24 * 60 * 60 * 1000);

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE due_date >= ? AND due_date <= ? AND status != 'done' 
                   AND parent_task_id IS NULL
             ORDER BY due_date ASC`,
            [now, future]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get upcoming tasks', error);
        return [];
    }
}

/**
 * Get task statistics for dashboard
 */
export async function getTaskStats(): Promise<TaskStats> {
    const db = await getCalendarDatabase();

    try {
        // Total tasks (excluding subtasks)
        const totalResult = await db.query(
            'SELECT COUNT(*) as count FROM calendar_tasks WHERE parent_task_id IS NULL'
        );
        const total = totalResult.values?.[0]?.count || 0;

        // By status
        const statusResult = await db.query(
            `SELECT status, COUNT(*) as count 
             FROM calendar_tasks 
             WHERE parent_task_id IS NULL
             GROUP BY status`
        );
        const byStatus: Record<string, number> = {};
        (statusResult.values || []).forEach((row: any) => {
            byStatus[row.status] = row.count;
        });

        // By priority
        const priorityResult = await db.query(
            `SELECT priority, COUNT(*) as count 
             FROM calendar_tasks 
             WHERE parent_task_id IS NULL
             GROUP BY priority`
        );
        const byPriority: Record<string, number> = {};
        (priorityResult.values || []).forEach((row: any) => {
            byPriority[row.priority] = row.count;
        });

        // Overdue count
        const overdueResult = await db.query(
            `SELECT COUNT(*) as count FROM calendar_tasks 
             WHERE due_date < ? AND status != 'done' AND parent_task_id IS NULL`,
            [Date.now()]
        );
        const overdue = overdueResult.values?.[0]?.count || 0;

        // Completed this week
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const completedResult = await db.query(
            `SELECT COUNT(*) as count FROM calendar_tasks 
             WHERE status = 'done' AND completed_at >= ? AND parent_task_id IS NULL`,
            [weekAgo]
        );
        const completedThisWeek = completedResult.values?.[0]?.count || 0;

        // Completion rate
        const doneCount = byStatus['done'] || 0;
        const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

        return {
            total,
            byStatus,
            byPriority,
            overdue,
            completedThisWeek,
            completionRate
        };
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get task stats', error);
        return {
            total: 0,
            byStatus: {},
            byPriority: {},
            overdue: 0,
            completedThisWeek: 0,
            completionRate: 0
        };
    }
}

/**
 * Search tasks by title or description
 */
export async function searchTasks(query: string, limit: number = 20): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();
    const searchPattern = `%${query}%`;

    try {
        const result = await db.query(
            `SELECT * FROM calendar_tasks 
             WHERE (title LIKE ? OR description LIKE ?) AND parent_task_id IS NULL
             ORDER BY due_date ASC
             LIMIT ?`,
            [searchPattern, searchPattern, limit]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to search tasks', error);
        return [];
    }
}
