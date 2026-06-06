import { AndroidAuto } from 'android-auto-capacitor';
import { logger } from '../../logger';
import { getKanbanBoard } from './taskQueries';

/**
 * Sync current Kanban Board state to Android Auto
 */
export async function syncKanbanToAuto() {
    try {
        const board = await getKanbanBoard();
        await AndroidAuto.updateScreen({
            type: 'kanban',
            payload: JSON.stringify(board)
        });
        logger.log('info', '[TaskDB] Synced Kanban to Android Auto');
    } catch (error) {
        // Silently fail if plugin not available or error
        // logger.log('warn', '[TaskDB] Auto sync failed', error);
    }
}
