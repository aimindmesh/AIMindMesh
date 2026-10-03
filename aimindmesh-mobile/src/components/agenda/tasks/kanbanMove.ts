/**
 * Pure board logic of the Kanban view: filters and drag-and-drop moves.
 */

import { CalendarTask, KanbanBoard, TaskFilterOptions, TaskStatus } from '../../../types/calendar';

/**
 * Whether a task passes the board filters. The board lists top-level tasks only, so
 * "has subtasks" is answered by the ids of the tasks that have some.
 */
export function matchesTaskFilters(
    task: CalendarTask,
    filters: TaskFilterOptions,
    idsWithSubtasks: Set<string>
): boolean {
    if (filters.assignee && task.assignee !== filters.assignee) return false;
    if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
    if (filters.hasSubtasks && !idsWithSubtasks.has(task.id)) return false;
    if (filters.hasPomodoroTarget && !task.pomodoroTarget) return false;
    if (filters.tags && filters.tags.length > 0 && !filters.tags.some(t => task.tags.includes(t))) return false;
    return true;
}

/**
 * Applies a drop to the board. The drag library counts positions in the filtered (visible)
 * columns, while the board holds every task: the task is found by id and inserted before the
 * visible task now at `destVisibleIndex` (or after the last visible one).
 * Returns the new board and the task's index in its full destination column, or null when
 * the task is not on the board.
 */
export function moveTaskInBoard(
    board: KanbanBoard,
    taskId: string,
    destStatus: TaskStatus,
    destVisibleIndex: number,
    isVisible: (task: CalendarTask) => boolean
): { board: KanbanBoard; order: number } | null {
    let moved: CalendarTask | undefined;
    const next = {} as KanbanBoard;
    for (const status of Object.keys(board) as TaskStatus[]) {
        next[status] = board[status].filter(t => {
            if (t.id !== taskId) return true;
            moved = t;
            return false;
        });
    }
    if (!moved) return null;

    const dest = next[destStatus] || [];
    const visible = dest.filter(isVisible);
    let order: number;
    if (destVisibleIndex < visible.length) {
        order = dest.indexOf(visible[destVisibleIndex]);
    } else if (visible.length > 0) {
        order = dest.indexOf(visible[visible.length - 1]) + 1;
    } else {
        order = dest.length;
    }

    next[destStatus] = [...dest.slice(0, order), { ...moved, status: destStatus }, ...dest.slice(order)];
    return { board: next, order };
}
