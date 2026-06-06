import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../../logger';
import { getCalendarDatabase } from '../calendarDatabase';
import { CalendarTask, TaskStatus, CreateTaskInput, UpdateTaskInput } from '../../../types/calendar';
import { generateTaskId, parseTaskRow } from './taskHelpers';
import { syncKanbanToAuto } from './taskSync';

/**
 * Get the next task order for a given status column
 */
async function getNextTaskOrder(db: SQLiteDBConnection, status: TaskStatus): Promise<number> {
    const result = await db.query(
        'SELECT MAX(task_order) as max_order FROM calendar_tasks WHERE status = ?',
        [status]
    );
    return (result.values?.[0]?.max_order || 0) + 1;
}

/**
 * Create a new task
 */
export async function createTask(
    input: CreateTaskInput
): Promise<CalendarTask> {
    const db = await getCalendarDatabase();

    const newTask: CalendarTask = {
        ...input,
        id: generateTaskId(),
        createdAt: Date.now(),
        order: await getNextTaskOrder(db, input.status),
        tags: input.tags || [],
        pomodoroCount: 0
    };

    try {
        await db.run(
            `INSERT INTO calendar_tasks (
                id, title, description, status, priority,
                created_at, due_date, completed_at,
                category, tags, assigned_to,
                estimated_hours, actual_hours,
                parent_task_id, linked_event_id,
                recurrence_rule, recurrence_parent_id,
                color, task_order,
                pomodoro_count, pomodoro_target,
                assignee, ai_config
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                newTask.id,
                newTask.title,
                newTask.description,
                newTask.status,
                newTask.priority,
                newTask.createdAt,
                newTask.dueDate,
                newTask.completedAt || null,
                newTask.category || null,
                JSON.stringify(newTask.tags),
                newTask.assignedTo || null,
                newTask.estimatedHours || null,
                newTask.actualHours || null,
                newTask.parentTaskId || null,
                newTask.linkedEventId || null,
                newTask.recurrenceRule ? JSON.stringify(newTask.recurrenceRule) : null,
                newTask.recurrenceParentId || null,
                newTask.color || null,
                newTask.order,
                newTask.pomodoroCount,
                newTask.pomodoroTarget || null,
                newTask.assignee || 'user',
                newTask.aiConfig ? JSON.stringify(newTask.aiConfig) : null
            ]
        );

        logger.log('info', `[TaskDB] Task created: ${newTask.id} - ${newTask.title}`);
        return newTask;
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to create task', error);
        throw error;
    } finally {
        syncKanbanToAuto().catch(e => logger.log('warn', '[TaskDB] Failed to sync to Auto', e));
    }
}

/**
 * Update an existing task
 */
export async function updateTask(
    id: string,
    updates: UpdateTaskInput
): Promise<void> {
    const db = await getCalendarDatabase();

    // Auto-set completedAt when marking as done
    if (updates.status === 'done' && !updates.completedAt) {
        updates.completedAt = Date.now();
    }

    // Clear completedAt if moving out of done
    if (updates.status && updates.status !== 'done') {
        updates.completedAt = undefined;
    }

    const fieldMappings: Record<string, string> = {
        title: 'title',
        description: 'description',
        status: 'status',
        priority: 'priority',
        dueDate: 'due_date',
        completedAt: 'completed_at',
        category: 'category',
        tags: 'tags',
        assignedTo: 'assigned_to',
        estimatedHours: 'estimated_hours',
        actualHours: 'actual_hours',
        parentTaskId: 'parent_task_id',
        linkedEventId: 'linked_event_id',
        recurrenceRule: 'recurrence_rule',
        recurrenceParentId: 'recurrence_parent_id',
        color: 'color',
        order: 'task_order',
        pomodoroCount: 'pomodoro_count',
        pomodoroTarget: 'pomodoro_target',
        assignee: 'assignee',
        aiConfig: 'ai_config'
    };

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
        const dbColumn = fieldMappings[key];
        if (dbColumn) {
            setClauses.push(`${dbColumn} = ?`);

            if (key === 'tags' && Array.isArray(value)) {
                values.push(JSON.stringify(value));
            } else if (key === 'recurrenceRule' && value) {
                values.push(JSON.stringify(value));
            } else if (key === 'aiConfig' && value) {
                values.push(JSON.stringify(value));
            } else if (value === undefined) {
                values.push(null);
            } else {
                values.push(value);
            }
        }
    }

    if (setClauses.length === 0) {
        return; // Nothing to update
    }

    values.push(id);

    try {
        await db.run(
            `UPDATE calendar_tasks SET ${setClauses.join(', ')} WHERE id = ?`,
            values
        );
        logger.log('info', `[TaskDB] Task updated: ${id}`);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to update task', error);
        throw error;
    } finally {
        syncKanbanToAuto().catch(e => logger.log('warn', '[TaskDB] Failed to sync to Auto', e));
    }
}

/**
 * Delete a task and its subtasks
 */
export async function deleteTask(id: string): Promise<void> {
    const db = await getCalendarDatabase();

    try {
        // Delete subtasks first (cascade)
        await db.run(
            'DELETE FROM calendar_tasks WHERE parent_task_id = ?',
            [id]
        );

        // Delete the task itself
        await db.run(
            'DELETE FROM calendar_tasks WHERE id = ?',
            [id]
        );

        logger.log('info', `[TaskDB] Task deleted: ${id}`);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to delete task', error);
        throw error;
    } finally {
        syncKanbanToAuto().catch(e => logger.log('warn', '[TaskDB] Failed to sync to Auto', e));
    }
}

/**
 * Get a task by ID
 */
export async function getTaskById(id: string): Promise<CalendarTask | null> {
    const db = await getCalendarDatabase();

    try {
        const result = await db.query(
            'SELECT * FROM calendar_tasks WHERE id = ?',
            [id]
        );

        if (!result.values || result.values.length === 0) {
            return null;
        }

        return parseTaskRow(result.values[0]);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get task by ID', error);
        return null;
    }
}

/**
 * Move a task to a new status and/or position
 */
export async function moveTask(
    taskId: string,
    newStatus: TaskStatus,
    newOrder: number
): Promise<void> {
    await updateTask(taskId, {
        status: newStatus,
        order: newOrder
    });
}

/**
 * Reorder tasks within a status column
 */
export async function reorderTasks(
    status: TaskStatus,
    taskIds: string[]
): Promise<void> {
    const db = await getCalendarDatabase();

    try {
        for (let i = 0; i < taskIds.length; i++) {
            await db.run(
                'UPDATE calendar_tasks SET task_order = ? WHERE id = ?',
                [i, taskIds[i]]
            );
        }
        logger.log('info', `[TaskDB] Reordered ${taskIds.length} tasks in ${status}`);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to reorder tasks', error);
        throw error;
    } finally {
        syncKanbanToAuto().catch(e => logger.log('warn', '[TaskDB] Failed to sync to Auto', e));
    }
}

/**
 * Get subtasks for a parent task
 */
export async function getSubtasks(parentTaskId: string): Promise<CalendarTask[]> {
    const db = await getCalendarDatabase();

    try {
        const result = await db.query(
            'SELECT * FROM calendar_tasks WHERE parent_task_id = ? ORDER BY task_order ASC',
            [parentTaskId]
        );

        return (result.values || []).map(parseTaskRow);
    } catch (error) {
        logger.log('error', '[TaskDB] Failed to get subtasks', error);
        return [];
    }
}

/**
 * Create a subtask under a parent task
 */
export async function createSubtask(
    parentId: string,
    title: string
): Promise<CalendarTask> {
    const parent = await getTaskById(parentId);
    if (!parent) {
        throw new Error('Parent task not found');
    }

    return await createTask({
        title,
        description: '',
        status: 'todo',
        priority: parent.priority,
        dueDate: parent.dueDate,
        parentTaskId: parentId,
        tags: []
    });
}

/**
 * Toggle subtask completion status
 */
export async function toggleSubtask(subtaskId: string): Promise<void> {
    const subtask = await getTaskById(subtaskId);
    if (!subtask) return;

    const newStatus: TaskStatus = subtask.status === 'done' ? 'todo' : 'done';
    await updateTask(subtaskId, { status: newStatus });
}
