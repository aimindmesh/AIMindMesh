import { logger } from '../../logger';
import { getCalendarDatabase } from './agendaSchema';
import { CalendarNote } from './agendaTypes';

/**
 * Add a new note
 */
export async function addNote(note: Omit<CalendarNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const database = await getCalendarDatabase();
    const id = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    try {
        await database.run(
            `INSERT INTO calendar_notes (id, date, content, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
            [id, note.date, note.content, note.category || 'general', now, now]
        );
        logger.log('info', `[CalendarDB] Added note for date: ${note.date}`);
        return id;
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to add note', error);
        throw error;
    }
}

/**
 * Update an existing note
 */
export async function updateNote(id: string, updates: Partial<Omit<CalendarNote, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    const database = await getCalendarDatabase();
    const now = Date.now();

    const fields: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.date !== undefined) { fields.push('date = ?'); values.push(updates.date); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }

    values.push(id);

    try {
        await database.run(
            `UPDATE calendar_notes SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
        logger.log('info', `[CalendarDB] Updated note: ${id}`);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to update note', error);
        throw error;
    }
}

/**
 * Delete a note by ID
 */
export async function deleteNote(id: string): Promise<void> {
    const database = await getCalendarDatabase();

    try {
        await database.run('DELETE FROM calendar_notes WHERE id = ?', [id]);
        logger.log('info', `[CalendarDB] Deleted note: ${id}`);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to delete note', error);
        throw error;
    }
}

/**
 * Get notes for a specific date
 */
export async function getNotesForDate(date: string): Promise<CalendarNote[]> {
    const database = await getCalendarDatabase();

    try {
        const result = await database.query(
            'SELECT * FROM calendar_notes WHERE date = ? ORDER BY created_at DESC',
            [date]
        );

        if (!result.values) return [];

        return result.values.map((row: any) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        }));
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get notes for date', error);
        return [];
    }
}

/**
 * Get notes within a date range
 */
export async function getNotesInRange(startDate: string, endDate: string): Promise<CalendarNote[]> {
    const database = await getCalendarDatabase();

    try {
        const result = await database.query(
            'SELECT * FROM calendar_notes WHERE date >= ? AND date <= ? ORDER BY date ASC, created_at DESC',
            [startDate, endDate]
        );

        if (!result.values) return [];

        return result.values.map((row: any) => ({
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        }));
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get notes in range', error);
        return [];
    }
}

/**
 * Get daily note for a specific date
 */
export async function getDailyNote(date: string): Promise<CalendarNote | null> {
    const database = await getCalendarDatabase();
    const id = `daily_${date}`;
    try {
        const result = await database.query('SELECT * FROM calendar_notes WHERE id = ?', [id]);
        if (!result.values || result.values.length === 0) return null;

        const row = result.values[0];
        return {
            id: row.id,
            date: row.date,
            content: row.content,
            category: row.category,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to get daily note', error);
        return null;
    }
}

/**
 * Save daily note for a specific date
 */
export async function saveDailyNote(date: string, content: string): Promise<void> {
    const database = await getCalendarDatabase();
    const id = `daily_${date}`;
    const now = Date.now();
    try {
        // Use COALESCE to keep original creation time if updating
        await database.run(
            `INSERT OR REPLACE INTO calendar_notes (id, date, content, category, created_at, updated_at)
             VALUES (?, ?, ?, 'daily_journal', COALESCE((SELECT created_at FROM calendar_notes WHERE id = ?), ?), ?)`,
            [id, date, content, id, now, now]
        );
        logger.log('info', `[CalendarDB] Saved daily note for: ${date}`);
    } catch (error) {
        logger.log('error', '[CalendarDB] Failed to save daily note', error);
        throw error;
    }
}
