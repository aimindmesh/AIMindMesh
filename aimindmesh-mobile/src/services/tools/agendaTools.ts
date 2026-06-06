/**
 * Agenda Tools for LLM
 * Allows the assistant to manage calendar events and notes
 */

import { ToolResult } from './types';
import * as CalendarService from '../calendar/calendarService';
import { logger } from '../logger';

/**
 * Add event to internal agenda
 */
export async function executeAddAgendaEvent(args: Record<string, unknown>): Promise<ToolResult> {
    const title = args.title as string;
    const dateStr = args.date as string; // YYYY-MM-DD
    const startTime = args.start_time as string | undefined; // HH:MM
    const endTime = args.end_time as string | undefined; // HH:MM
    const location = args.location as string | undefined;
    const notes = args.notes as string | undefined;
    const isAllDay = (args.all_day as boolean) || false;

    if (!title || !dateStr) {
        return {
            success: false,
            message: 'Title and date are required to create an event.',
        };
    }

    try {
        const [year, month, day] = dateStr.split('-').map(Number);

        let startDate: Date;
        let endDate: Date;

        if (isAllDay) {
            startDate = new Date(year, month - 1, day, 0, 0, 0);
            endDate = new Date(year, month - 1, day, 23, 59, 59);
        } else {
            const [startHour, startMin] = (startTime || '09:00').split(':').map(Number);
            const [endHour, endMin] = (endTime || '10:00').split(':').map(Number);
            startDate = new Date(year, month - 1, day, startHour, startMin, 0);
            endDate = new Date(year, month - 1, day, endHour, endMin, 0);
        }

        const eventId = await CalendarService.addEvent({
            title,
            startTime: startDate,
            endTime: endDate,
            location,
            notes,
            isAllDay,
            isRecurring: false,
        });

        logger.log('info', `[AgendaTools] Event added: ${title} on ${dateStr}`);

        return {
            success: true,
            message: `Event "${title}" added for ${dateStr}${!isAllDay ? ` at ${startTime}` : ''}.`,
            data: { eventId, title, date: dateStr },
        };
    } catch (error) {
        logger.log('error', '[AgendaTools] Failed to add event', error);
        return {
            success: false,
            message: 'Error creating event.',
        };
    }
}

/**
 * Add note to internal agenda
 */
export async function executeAddAgendaNote(args: Record<string, unknown>): Promise<ToolResult> {
    const content = args.content as string;
    const dateStr = args.date as string; // YYYY-MM-DD
    const category = (args.category as string) || 'general';

    if (!content || !dateStr) {
        return {
            success: false,
            message: 'Content and date are required to create a note.',
        };
    }

    try {
        const noteId = await CalendarService.addNote({
            date: dateStr,
            content,
            category,
        });

        logger.log('info', `[AgendaTools] Note added for ${dateStr}`);

        return {
            success: true,
            message: `Note added for ${dateStr}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
            data: { noteId, date: dateStr },
        };
    } catch (error) {
        logger.log('error', '[AgendaTools] Failed to add note', error);
        return {
            success: false,
            message: 'Error creating note.',
        };
    }
}

/**
 * Delete an agenda item (event or note)
 */
export async function executeDeleteAgendaItem(args: Record<string, unknown>): Promise<ToolResult> {
    const itemId = args.id as string;
    const itemType = args.type as 'event' | 'note';

    if (!itemId || !itemType) {
        return {
            success: false,
            message: 'Item ID and type are required.',
        };
    }

    try {
        if (itemType === 'event') {
            await CalendarService.deleteEvent(itemId);
        } else {
            await CalendarService.deleteNote(itemId);
        }

        logger.log('info', `[AgendaTools] Deleted ${itemType}: ${itemId}`);

        return {
            success: true,
            message: `${itemType === 'event' ? 'Event' : 'Note'} successfully deleted.`,
        };
    } catch (error) {
        logger.log('error', '[AgendaTools] Failed to delete item', error);
        return {
            success: false,
            message: 'Error during deletion.',
        };
    }
}

/**
 * Search the agenda for events and notes
 */
export async function executeSearchAgenda(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const limit = (args.limit as number) || 10;

    if (!query) {
        return {
            success: false,
            message: 'Search query is required.',
        };
    }

    try {
        const results = await CalendarService.searchAgenda(query, limit);

        const eventsList = results.events.map(e => {
            const dateStr = e.startTime.toLocaleDateString('en-US');
            const timeStr = e.isAllDay ? 'All day' : CalendarService.formatTimeString(e.startTime);
            return `- [Event] ${dateStr} ${timeStr}: ${e.title}${e.location ? ` (${e.location})` : ''}`;
        });

        const notesList = results.notes.map(n => {
            return `- [Note] ${n.date}: ${n.content.substring(0, 100)}${n.content.length > 100 ? '...' : ''}`;
        });

        const totalResults = eventsList.length + notesList.length;

        if (totalResults === 0) {
            return {
                success: true,
                message: `No results found for "${query}".`,
                data: { events: [], notes: [] },
            };
        }

        const resultText = [
            ...eventsList,
            ...notesList,
        ].join('\n');

        return {
            success: true,
            message: `Found ${totalResults} results for "${query}":\n${resultText}`,
            data: results,
        };
    } catch (error) {
        logger.log('error', '[AgendaTools] Failed to search agenda', error);
        return {
            success: false,
            message: 'Error during search.',
        };
    }
}

/**
 * List agenda items for a specific day
 */
export async function executeListAgendaDay(args: Record<string, unknown>): Promise<ToolResult> {
    const dateStr = args.date as string; // YYYY-MM-DD

    if (!dateStr) {
        return {
            success: false,
            message: 'Date is required.',
        };
    }

    try {
        const date = CalendarService.parseDateString(dateStr);
        const data = await CalendarService.getDayAgenda(date, false);

        if (data.events.length === 0 && data.notes.length === 0) {
            return {
                success: true,
                message: `No events or notes for ${dateStr}.`,
                data: { events: [], notes: [] },
            };
        }

        const eventsList = data.events.map(e => {
            const timeStr = e.isAllDay ? 'All day' : `${CalendarService.formatTimeString(e.startTime)} - ${CalendarService.formatTimeString(e.endTime)}`;
            return `  - ${timeStr}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
        });

        const notesList = data.notes.map(n => {
            return `  - [${n.category}] ${n.content.substring(0, 80)}${n.content.length > 80 ? '...' : ''}`;
        });

        let message = `Agenda for ${dateStr}:\n`;
        if (eventsList.length > 0) {
            message += `\n📅 Events (${eventsList.length}):\n${eventsList.join('\n')}`;
        }
        if (notesList.length > 0) {
            message += `\n\n📝 Notes (${notesList.length}):\n${notesList.join('\n')}`;
        }

        return {
            success: true,
            message,
            data,
        };
    } catch (error) {
        logger.log('error', '[AgendaTools] Failed to list day agenda', error);
        return {
            success: false,
            message: 'Error retrieving agenda.',
        };
    }
}
