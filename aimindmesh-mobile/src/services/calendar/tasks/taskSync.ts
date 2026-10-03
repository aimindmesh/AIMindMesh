import { AndroidAuto } from 'android-auto-capacitor';
import { logger } from '../../logger';
import { getKanbanBoard } from './taskQueries';
import { KanbanBoard, TaskStatus } from '../../../types/calendar';

const COLUMN_ORDER: TaskStatus[] = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const COLUMN_TITLES: Record<TaskStatus, string> = {
    'backlog': 'Backlog',
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'review': 'Review',
    'done': 'Done'
};

/**
 * Board in the normalized shape AutoUtils.parseKanbanColumns reads:
 * { columns: { [id]: { id, title, taskIds } }, columnOrder, tasks: { [id]: { id, content } } }.
 * Every sender uses it: the raw board leaves the car screen empty.
 */
export function buildAutoKanbanPayload(board: KanbanBoard): string {
    const columns: Record<string, { id: TaskStatus; title: string; taskIds: string[] }> = {};
    const tasks: Record<string, { id: string; content: string }> = {};

    for (const status of COLUMN_ORDER) {
        const statusTasks = board[status] || [];
        columns[status] = { id: status, title: COLUMN_TITLES[status], taskIds: statusTasks.map(t => t.id) };
        for (const t of statusTasks) {
            tasks[t.id] = { id: t.id, content: t.title };
        }
    }

    return JSON.stringify({ columns, columnOrder: COLUMN_ORDER, tasks });
}

/**
 * Sync current Kanban Board state to Android Auto
 */
export async function syncKanbanToAuto() {
    try {
        const board = await getKanbanBoard();
        await AndroidAuto.updateScreen({
            type: 'kanban',
            payload: buildAutoKanbanPayload(board)
        });
        logger.log('info', '[TaskDB] Synced Kanban to Android Auto');
    } catch (error) {
        // Silently fail if plugin not available or error
        // logger.log('warn', '[TaskDB] Auto sync failed', error);
    }
}
