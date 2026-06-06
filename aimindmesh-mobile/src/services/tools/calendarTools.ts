/**
 * Calendar Tool Implementations
 */

import { createCalendarEvent, listCalendarEvents, CalendarEvent } from '../calendar';
import { ToolResult } from './types';

export async function executeCreateCalendarEvent(args: Record<string, unknown>): Promise<ToolResult> {
    const title = args.title as string;
    const dateStr = args.date as string;
    const timeStr = args.time as string;
    const durationMinutes = (args.duration_minutes as number) || 60;
    const notes = args.notes as string | undefined;

    // Parse date and time
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);

    const startDate = new Date(year, month - 1, day, hours, minutes);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    const event: CalendarEvent = {
        title,
        startDate,
        endDate,
        notes,
        isAllDay: false
    };

    const success = await createCalendarEvent(event);

    if (success) {
        return {
            success: true,
            message: `Created calendar event "${title}" on ${dateStr} at ${timeStr}`,
            data: { title, date: dateStr, time: timeStr }
        };
    } else {
        return {
            success: false,
            message: 'Failed to create calendar event. Please check calendar permissions.'
        };
    }
}

export async function executeListCalendarEvents(args: Record<string, unknown>): Promise<ToolResult> {
    const startDateStr = args.start_date as string | undefined;
    const endDateStr = args.end_date as string | undefined;
    const durationDays = (args.duration_days as number) || 7;

    const now = new Date();
    let startDate: Date;

    if (startDateStr) {
        const [year, month, day] = startDateStr.split('-').map(Number);
        startDate = new Date(year, month - 1, day);
    } else {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0); // Start of today
    }

    let endDate: Date;
    if (endDateStr) {
        const [year, month, day] = endDateStr.split('-').map(Number);
        endDate = new Date(year, month - 1, day);
        endDate.setHours(23, 59, 59, 999);
    } else {
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + durationDays);
        endDate.setHours(23, 59, 59, 999);
    }

    const events = await listCalendarEvents(startDate, endDate);

    if (events.length === 0) {
        return {
            success: true,
            message: `No calendar events found from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}.`,
            data: { events: [] }
        };
    }

    const eventList = events.map(e => {
        const dateStr = e.startDate.toLocaleDateString();
        const timeStr = e.isAllDay ? 'All Day' : e.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `- ${dateStr} ${timeStr}: ${e.title} ${e.location ? `(at ${e.location})` : ''}`;
    }).join('\n');

    return {
        success: true,
        message: `Found ${events.length} events:\n${eventList}`,
        data: { events }
    };
}
