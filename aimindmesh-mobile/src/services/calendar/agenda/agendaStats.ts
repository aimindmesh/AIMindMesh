import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';

/**
 * Clear all agenda data
 */
export async function clearAllAgendaData(): Promise<void> {
    const database = await getCalendarDatabase();

    try {
        await database.run('DELETE FROM calendar_events');
        await database.run('DELETE FROM calendar_notes');
        logger.log('info', '[CalendarDB] Cleared all agenda data');
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to clear agenda data', error);
        throw error;
    }
}

/**
 * Get statistics about the agenda
 */
export async function getAgendaStats(): Promise<{ eventCount: number; noteCount: number }> {
    const database = await getCalendarDatabase();

    try {
        const eventsResult = await database.query('SELECT COUNT(*) as count FROM calendar_events');
        const notesResult = await database.query('SELECT COUNT(*) as count FROM calendar_notes');

        return {
            eventCount: eventsResult.values?.[0]?.count || 0,
            noteCount: notesResult.values?.[0]?.count || 0
        };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get agenda stats', error);
        return { eventCount: 0, noteCount: 0 };
    }
}
