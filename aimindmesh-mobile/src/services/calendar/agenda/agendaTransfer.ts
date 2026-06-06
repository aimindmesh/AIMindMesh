import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';

/**
 * Export all agenda data as JSON
 */
export async function exportAgendaData(): Promise<string> {
    const database = await getCalendarDatabase();

    try {
        const eventsResult = await database.query('SELECT * FROM calendar_events ORDER BY start_time');
        const notesResult = await database.query('SELECT * FROM calendar_notes ORDER BY date');

        const events = (eventsResult.values || []).map((row: any) => ({
            id: row.id,
            title: row.title,
            startTime: row.start_time,
            endTime: row.end_time,
            location: row.location,
            notes: row.notes,
            isAllDay: row.is_all_day === 1,
            isRecurring: row.is_recurring === 1,
            recurrenceRule: row.recurrence_rule,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        const notes = (notesResult.values || []).map((row: any) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        return JSON.stringify({
            version: 1,
            exportedAt: new Date().toISOString(),
            events,
            notes
        }, null, 2);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to export agenda data', error);
        throw error;
    }
}

/**
 * Import agenda data from JSON
 */
export async function importAgendaData(jsonData: string, overwrite: boolean = false): Promise<{ eventsImported: number; notesImported: number }> {
    const database = await getCalendarDatabase();

    try {
        const data = JSON.parse(jsonData);

        if (!data.events || !data.notes) {
            throw new Error('Invalid agenda data format');
        }

        if (overwrite) {
            await database.run('DELETE FROM calendar_events');
            await database.run('DELETE FROM calendar_notes');
        }

        let eventsImported = 0;
        let notesImported = 0;

        // Import events
        for (const event of data.events) {
            try {
                await database.run(
                    `INSERT OR REPLACE INTO calendar_events 
           (id, title, start_time, end_time, location, notes, is_all_day, is_recurring, recurrence_rule, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        event.id,
                        event.title,
                        event.startTime,
                        event.endTime,
                        event.location || null,
                        event.notes || null,
                        event.isAllDay ? 1 : 0,
                        event.isRecurring ? 1 : 0,
                        event.recurrenceRule || null,
                        event.createdAt,
                        event.updatedAt
                    ]
                );
                eventsImported++;
            } catch (e) {
                logger.log('warn', `[CalendarDB] Failed to import event: ${event.id}`, e);
            }
        }

        // Import notes
        for (const note of data.notes) {
            try {
                await database.run(
                    `INSERT OR REPLACE INTO calendar_notes (id, date, content, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
                    [note.id, note.date, note.content, note.category, note.createdAt, note.updatedAt]
                );
                notesImported++;
            } catch (e) {
                logger.log('warn', `[CalendarDB] Failed to import note: ${note.id}`, e);
            }
        }

        logger.log('info', `[CalendarDB] Imported ${eventsImported} events and ${notesImported} notes`);
        return { eventsImported, notesImported };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to import agenda data', error);
        throw error;
    }
}
