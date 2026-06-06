import { CalendarTask, TaskStatus, TaskPriority } from '../../../types/calendar';

export function generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function parseTaskRow(row: any): CalendarTask {
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        status: row.status as TaskStatus,
        priority: row.priority as TaskPriority,
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
        pomodoroTarget: row.pomodoro_target || undefined,
        assignee: row.assignee || 'user',
        aiConfig: row.ai_config ? JSON.parse(row.ai_config) : undefined
    };
}
