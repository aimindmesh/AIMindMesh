import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';
import { CalendarEvent } from './agendaTypes';

/**
 * Add a new calendar event
 */
export async function addEvent(event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const database = await getCalendarDatabase();
    const id = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
        await database.run(
            `INSERT INTO calendar_events 
       (id, title, start_time, end_time, location, notes, is_all_day, is_recurring, recurrence_rule, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                event.title,
                event.startTime.getTime(),
                event.endTime.getTime(),
                event.location || null,
                event.notes || null,
                event.isAllDay ? 1 : 0,
                event.isRecurring ? 1 : 0,
                event.recurrenceRule || null,
                now,
                now
            ]
        );
        logger.log('info', `[CalendarDB] Added event: ${event.title}`);
        return id;
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to add event', error);
        throw error;
    }
}

/**
 * Update an existing event
 */
export async function updateEvent(id: string, updates: Partial<Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const database = await getCalendarDatabase();
    const now = Date.now();

    const fields: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.startTime !== undefined) { fields.push('start_time = ?'); values.push(updates.startTime.getTime()); }
    if (updates.endTime !== undefined) { fields.push('end_time = ?'); values.push(updates.endTime.getTime()); }
    if (updates.location !== undefined) { fields.push('location = ?'); values.push(updates.location); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); values.push(updates.notes); }
    if (updates.isAllDay !== undefined) { fields.push('is_all_day = ?'); values.push(updates.isAllDay ? 1 : 0); }
    if (updates.isRecurring !== undefined) { fields.push('is_recurring = ?'); values.push(updates.isRecurring ? 1 : 0); }
    if (updates.recurrenceRule !== undefined) { fields.push('recurrence_rule = ?'); values.push(updates.recurrenceRule); }

    values.push(id);

    try {
        await database.run(
            `UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
        logger.log('info', `[CalendarDB] Updated event: ${id}`);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to update event', error);
        throw error;
    }
}

/**
 * Delete an event by ID
 */
export async function deleteEvent(id: string): Promise<void> {
    const database = await getCalendarDatabase();

    try {
        await database.run('DELETE FROM calendar_events WHERE id = ?', [id]);
        logger.log('info', `[CalendarDB] Deleted event: ${id}`);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to delete event', error);
        throw error;
    }
}

/**
 * Get events within a date range
 */
export async function getEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const database = await getCalendarDatabase();

    try {
        const result = await database.query(
            `SELECT * FROM calendar_events 
       WHERE start_time >= ? AND start_time <= ?
       ORDER BY start_time ASC`,
            [startDate.getTime(), endDate.getTime()]
        );

        if (!result.values) return [];

        return result.values.map((row: any) => ({
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
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get events', error);
        return [];
    }
}

/**
 * Get a single event by ID
 */
export async function getEventById(id: string): Promise<CalendarEvent | null> {
    const database = await getCalendarDatabase();

    try {
        const result = await database.query(
            'SELECT * FROM calendar_events WHERE id = ?',
            [id]
        );

        if (!result.values || result.values.length === 0) return null;

        const row = result.values[0] as any;
        return {
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
        };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get event by ID', error);
        return null;
    }
}
