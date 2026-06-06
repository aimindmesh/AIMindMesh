/**
 * Task Tools for LLM
 * Allows the assistant to manage Kanban board tasks
 */

import { ToolResult } from './types';
import * as TaskDB from '../calendar/taskDatabase';
import { CalendarTask, TaskPriority, TaskStatus } from '../../types/calendar';
import { logger } from '../logger';

/**
 * Create a new task
 */
export async function executeCreateTask(args: Record<string, unknown>): Promise<ToolResult> {
    const title = args.title as string;
    const description = (args.description as string) || '';
    const dueDateStr = args.due_date as string | undefined;
    const priority = (args.priority as TaskPriority) || 'medium';
    const tags = (args.tags as string[]) || [];
    const estimatedHours = args.estimated_hours as number | undefined;
    const pomodoroTarget = args.pomodoro_target as number | undefined;

    if (!title) {
        return {
            success: false,
            message: 'Title is required to create a task.',
        };
    }

    try {
        // Parse due date or default to tomorrow
        let dueDate: number;
        if (dueDateStr) {
            const [year, month, day] = dueDateStr.split('-').map(Number);
            dueDate = new Date(year, month - 1, day, 23, 59, 59).getTime();
        } else {
            // Default to tomorrow at end of day
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(23, 59, 59, 999);
            dueDate = tomorrow.getTime();
        }

        const task = await TaskDB.createTask({
            title,
            description,
            status: 'todo',
            priority,
            dueDate,
            tags,
            estimatedHours,
            pomodoroTarget,
        });

        logger.log('info', `[TaskTools] Task created: ${task.id} - ${title}`);

        const priorityLabel = {
            low: 'Low',
            medium: 'Medium',
            high: 'High',
            urgent: 'Urgent'
        }[priority];

        return {
            success: true,
            message: `Task "${title}" created with priority ${priorityLabel}. Due date: ${new Date(dueDate).toLocaleDateString('en-US')}.`,
            data: { taskId: task.id, title, dueDate: new Date(dueDate).toLocaleDateString('en-US') },
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to create task', error);
        return {
            success: false,
            message: 'Error creating the task.',
        };
    }
}

/**
 * Mark a task as completed
 */
export async function executeCompleteTask(args: Record<string, unknown>): Promise<ToolResult> {
    const taskId = args.task_id as string;

    if (!taskId) {
        return {
            success: false,
            message: 'Task ID is required.',
        };
    }

    try {
        const task = await TaskDB.getTaskById(taskId);
        if (!task) {
            return {
                success: false,
                message: `Task with ID "${taskId}" not found.`,
            };
        }

        await TaskDB.updateTask(taskId, {
            status: 'done',
            completedAt: Date.now()
        });

        logger.log('info', `[TaskTools] Task completed: ${taskId}`);

        return {
            success: true,
            message: `🎉 Task "${task.title}" completed!`,
            data: { taskId, title: task.title },
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to complete task', error);
        return {
            success: false,
            message: 'Error completing the task.',
        };
    }
}

/**
 * List tasks with optional filters
 */
export async function executeListTasks(args: Record<string, unknown>): Promise<ToolResult> {
    const statusFilter = args.status as string | undefined;
    const priorityFilter = args.priority as string | undefined;
    const includeOverdue = args.include_overdue as boolean | undefined;
    const daysAhead = args.days_ahead as number | undefined;

    try {
        let tasks: CalendarTask[] = [];

        if (includeOverdue) {
            tasks = await TaskDB.getOverdueTasks();
        } else if (daysAhead) {
            tasks = await TaskDB.getUpcomingTasks(daysAhead);
        } else if (statusFilter && statusFilter !== 'all') {
            tasks = await TaskDB.getTasksByStatus(statusFilter as TaskStatus);
        } else {
            // Get all from Kanban board
            const board = await TaskDB.getKanbanBoard();
            tasks = [
                ...board.backlog,
                ...board.todo,
                ...board['in-progress'],
                ...board.review,
                ...board.done.slice(0, 5) // Limit done tasks
            ];
        }

        // Apply priority filter
        if (priorityFilter && priorityFilter !== 'all') {
            tasks = tasks.filter(t => t.priority === priorityFilter);
        }

        if (tasks.length === 0) {
            return {
                success: true,
                message: 'No tasks found with the specified filters.',
                data: { tasks: [] },
            };
        }

        const priorityEmoji = {
            low: '⚪',
            medium: '🔵',
            high: '🟠',
            urgent: '🔴'
        };

        const statusLabel = {
            backlog: 'Backlog',
            todo: 'To Do',
            'in-progress': 'In Progress',
            review: 'Review',
            done: 'Done'
        };

        const tasksList = tasks.slice(0, 15).map(t => {
            const dueDateStr = new Date(t.dueDate).toLocaleDateString('en-US');
            const isOverdue = t.dueDate < Date.now() && t.status !== 'done';
            return `${priorityEmoji[t.priority as TaskPriority]} ${t.title} [${statusLabel[t.status as TaskStatus]}] - Due: ${dueDateStr}${isOverdue ? ' ⚠️ OVERDUE' : ''}`;
        });

        const overdueCount = tasks.filter(t => t.dueDate < Date.now() && t.status !== 'done').length;

        let message = `📋 Tasks (${tasks.length}):\n${tasksList.join('\n')}`;
        if (overdueCount > 0) {
            message += `\n\n⚠️ ${overdueCount} overdue tasks!`;
        }
        if (tasks.length > 15) {
            message += `\n\n...and ${tasks.length - 15} more tasks.`;
        }

        return {
            success: true,
            message,
            data: { tasks: tasks.slice(0, 15).map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })) },
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to list tasks', error);
        return {
            success: false,
            message: 'Error retrieving tasks.',
        };
    }
}

/**
 * Update task priority
 */
export async function executeUpdateTaskPriority(args: Record<string, unknown>): Promise<ToolResult> {
    const taskId = args.task_id as string;
    const priority = args.priority as TaskPriority;

    if (!taskId || !priority) {
        return {
            success: false,
            message: 'Task ID and priority are required.',
        };
    }

    try {
        const task = await TaskDB.getTaskById(taskId);
        if (!task) {
            return {
                success: false,
                message: `Task with ID "${taskId}" not found.`,
            };
        }

        await TaskDB.updateTask(taskId, { priority });

        const priorityLabel = {
            low: 'Low',
            medium: 'Medium',
            high: 'High',
            urgent: 'Urgent'
        }[priority];

        logger.log('info', `[TaskTools] Task priority updated: ${taskId} -> ${priority}`);

        return {
            success: true,
            message: `Priority of task "${task.title}" updated to ${priorityLabel}.`,
            data: { taskId, title: task.title, priority },
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to update task priority', error);
        return {
            success: false,
            message: 'Error updating priority.',
        };
    }
}

/**
 * Add a subtask to an existing task
 */
export async function executeAddTaskSubtask(args: Record<string, unknown>): Promise<ToolResult> {
    const parentTaskId = args.parent_task_id as string;
    const title = args.title as string;

    if (!parentTaskId || !title) {
        return {
            success: false,
            message: 'Parent task ID and title are required.',
        };
    }

    try {
        const parentTask = await TaskDB.getTaskById(parentTaskId);
        if (!parentTask) {
            return {
                success: false,
                message: `Parent task with ID "${parentTaskId}" not found.`,
            };
        }

        const subtask = await TaskDB.createSubtask(parentTaskId, title);

        logger.log('info', `[TaskTools] Subtask added: ${subtask.id} to ${parentTaskId}`);

        return {
            success: true,
            message: `Subtask "${title}" added to "${parentTask.title}".`,
            data: { subtaskId: subtask.id, parentTaskId, title },
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to add subtask', error);
        return {
            success: false,
            message: 'Error adding subtask.',
        };
    }
}

/**
 * Get task statistics
 */
export async function executeGetTaskStats(): Promise<ToolResult> {
    try {
        const stats = await TaskDB.getTaskStats();

        const message = [
            `📊 Task Statistics:`,
            ``,
            `📌 Total: ${stats.total}`,
            `📋 By status:`,
            `  - Backlog: ${stats.byStatus['backlog'] || 0}`,
            `  - To Do: ${stats.byStatus['todo'] || 0}`,
            `  - In Progress: ${stats.byStatus['in-progress'] || 0}`,
            `  - Review: ${stats.byStatus['review'] || 0}`,
            `  - Done: ${stats.byStatus['done'] || 0}`,
            ``,
            `⚠️ Overdue: ${stats.overdue}`,
            `✅ Completed this week: ${stats.completedThisWeek}`,
            `📈 Completion rate: ${stats.completionRate}%`,
        ].join('\n');

        return {
            success: true,
            message,
            data: stats,
        };
    } catch (error) {
        logger.log('error', '[TaskTools] Failed to get task stats', error);
        return {
            success: false,
            message: 'Error retrieving statistics.',
        };
    }
}
