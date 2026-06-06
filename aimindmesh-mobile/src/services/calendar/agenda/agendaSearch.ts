import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';
import { CalendarEvent, CalendarNote } from './agendaTypes';

/**
 * Search across both events and notes
 */
export async function searchAgenda(query: string, limit: number = 20): Promise<{
    events: CalendarEvent[];
    notes: CalendarNote[];
}> {
    const database = await getCalendarDatabase();
    const searchPattern = `%${query}%`;

    try {
        // Search events
        const eventsResult = await database.query(
            `SELECT * FROM calendar_events 
       WHERE title LIKE ? OR notes LIKE ? OR location LIKE ?
       ORDER BY start_time DESC
       LIMIT ?`,
            [searchPattern, searchPattern, searchPattern, limit]
        );

        // Search notes
        const notesResult = await database.query(
            `SELECT * FROM calendar_notes 
       WHERE content LIKE ? OR category LIKE ?
       ORDER BY date DESC
       LIMIT ?`,
            [searchPattern, searchPattern, limit]
        );

        const events = (eventsResult.values || []).map((row: any) => ({
            id: row.id,
            title: row.title,
            startTime: new Date(row.start_time),
            endTime: new Date(row.end_time),
            location: row.location,
            notes: row.notes,
            isAllDay: row.is_all_day === 1,
            isRecurring: row.is_recurring === 1,
            recurrenceRule: row.recurrence_rule,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            isSystemEvent: false
        }));

        const notes = (notesResult.values || []).map((row: any) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        }));

        return { events, notes };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to search agenda', error);
        return { events: [], notes: [] };
    }
}
