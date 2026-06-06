import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { CalendarPermissionScope } from '@ebarooni/capacitor-calendar/dist/esm/schemas/enums/calendar-permission-scope';
import { logger } from './logger';

export interface CalendarEvent {
    title: string;
    location?: string;
    notes?: string;
    startDate: Date;
    endDate: Date;
    isAllDay?: boolean;
}

export interface ReminderRequest {
    what: string;
    when: Date;
    location?: string;
}

/**
 * Request calendar permissions
 */
export const requestCalendarPermissions = async (): Promise<boolean> => {
    try {
        const response = await CapacitorCalendar.requestAllPermissions();
        const result = response.result;
        logger.log('info', 'Calendar permissions result', result);
        return result[CalendarPermissionScope.READ_CALENDAR] === 'granted' &&
            result[CalendarPermissionScope.WRITE_CALENDAR] === 'granted';
    } catch (error) {
        logger.log('error', 'Failed to request calendar permissions', error);
        return false;
    }
};

/**
 * Check if calendar permissions are granted
 */
export const checkCalendarPermissions = async (): Promise<boolean> => {
    try {
        const response = await CapacitorCalendar.checkAllPermissions();
        const result = response.result;
        return result[CalendarPermissionScope.READ_CALENDAR] === 'granted' &&
            result[CalendarPermissionScope.WRITE_CALENDAR] === 'granted';
    } catch (error) {
        logger.log('error', 'Failed to check calendar permissions', error);
        return false;
    }
};

/**
 * List available calendars
 */
export const listCalendars = async (): Promise<any[]> => {
    try {
        const response = await CapacitorCalendar.listCalendars();
        logger.log('info', 'Available calendars', response.result);
        return response.result;
    } catch (error) {
        logger.log('error', 'Failed to list calendars', error);
        return [];
    }
}

/**
 * Create a calendar event
 */
export const createCalendarEvent = async (event: CalendarEvent): Promise<boolean> => {
    try {
        // Check permissions first
        const hasPermission = await checkCalendarPermissions();
        if (!hasPermission) {
            const granted = await requestCalendarPermissions();
            if (!granted) {
                logger.log('warn', 'Calendar permissions not granted');
                return false;
            }
        }

        // List calendars to find a default one
        const calendars = await listCalendars();
        let calendarId = null;

        if (calendars && calendars.length > 0) {
            // Try to find a primary or writable calendar
            // Adjust usage based on actual plugin response structure
            const primary = calendars.find((c: any) => c.isPrimary) || calendars[0];
            if (primary) {
                calendarId = primary.id;
                logger.log('info', `Selected calendar: ${primary.id} (${primary.name})`);
            }
        }

        // Create the event
        const eventOptions: any = {
            title: event.title,
            location: event.location,
            description: event.notes, // 'notes' is 'description' in the plugin
            startDate: event.startDate.getTime(),
            endDate: event.endDate.getTime(),
            isAllDay: event.isAllDay || false,
        };

        if (calendarId) {
            eventOptions.calendarId = calendarId;
        }

        logger.log('info', 'Creating event with options', eventOptions);

        const result = await CapacitorCalendar.createEvent(eventOptions);

        logger.log('info', 'Calendar event created successfully', { event, result });
        return true;
    } catch (error) {
        logger.log('error', 'Failed to create calendar event', error);
        return false;
    }
};

/**
 * List calendar events in a given range
 */
export const listCalendarEvents = async (startDate: Date, endDate: Date): Promise<CalendarEvent[]> => {
    try {
        // Check permissions first
        const hasPermission = await checkCalendarPermissions();
        if (!hasPermission) {
            const granted = await requestCalendarPermissions();
            if (!granted) {
                logger.log('warn', 'Calendar permissions not granted');
                return [];
            }
        }

        const response = await CapacitorCalendar.listEventsInRange({
            from: startDate.getTime(),
            to: endDate.getTime(),
        });

        // Map the raw events to our CalendarEvent interface
        // Note: The plugin returns objects that match our interface almost exactly, 
        // but we ensure type safety here
        return response.result.map((event: any) => ({
            title: event.title,
            location: event.location,
            notes: event.description,
            startDate: new Date(event.startDate),
            endDate: new Date(event.endDate),
            isAllDay: event.isAllDay,
        }));
    } catch (error) {
        logger.log('error', 'Failed to list calendar events', error);
        return [];
    }
};

/**
 * Parse natural language date expressions
 */
export const parseNaturalDate = (text: string): Date | null => {
    const now = new Date();
    const lowerText = text.toLowerCase();
    let targetDate: Date | null = null;

    // Today
    if (lowerText.includes('oggi') || lowerText.includes('today')) {
        targetDate = new Date(now);
    }

    // Tomorrow
    else if (lowerText.includes('domani') || lowerText.includes('tomorrow')) {
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 1);
    }

    // Day after tomorrow
    else if (lowerText.includes('dopodomani') || lowerText.includes('after tomorrow')) {
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 2);
    }

    // In X days
    else {
        const daysMatch = lowerText.match(/(?:fra|tra|in)\s+(\d+)\s+(?:giorn[oi]|days)/);
        if (daysMatch) {
            const days = parseInt(daysMatch[1]);
            targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + days);
        }
    }

    // In X weeks
    if (!targetDate) {
        const weeksMatch = lowerText.match(/(?:fra|tra|in)\s+(\d+)\s+(?:settiman[ae]|weeks)/);
        if (weeksMatch) {
            const weeks = parseInt(weeksMatch[1]);
            targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + (weeks * 7));
        }
    }

    // Specific date: "the 15 december", "the 20/12", "15-12-2024"
    if (!targetDate) {
        const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
            'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
            'january', 'february', 'march', 'april', 'may', 'june',
            'july', 'august', 'september', 'october', 'november', 'december'];

        // The DD MONTH (e.g., "the 15 december" or "15 december")
        const dateMonthMatch = lowerText.match(/(?:il|the)?\s*(\d{1,2})\s*(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)/);
        if (dateMonthMatch) {
            const day = parseInt(dateMonthMatch[1]);
            const monthStr = dateMonthMatch[2];
            let monthIndex = months.indexOf(monthStr);
            if (monthIndex >= 12) monthIndex -= 12; // Handle English month names

            targetDate = new Date(now.getFullYear(), monthIndex, day);

            // If the date has passed this year, use next year
            if (targetDate < now) {
                targetDate.setFullYear(targetDate.getFullYear() + 1);
            }
        }
    }

    // DD/MM or DD-MM or DD.MM
    if (!targetDate) {
        const shortDateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})/);
        if (shortDateMatch) {
            const day = parseInt(shortDateMatch[1]);
            const month = parseInt(shortDateMatch[2]) - 1; // Months are 0-indexed
            targetDate = new Date(now.getFullYear(), month, day);

            if (targetDate < now) {
                targetDate.setFullYear(targetDate.getFullYear() + 1);
            }
        }
    }

    // DD/MM/YYYY or DD-MM-YYYY
    if (!targetDate) {
        const fullDateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
        if (fullDateMatch) {
            const day = parseInt(fullDateMatch[1]);
            const month = parseInt(fullDateMatch[2]) - 1;
            const year = parseInt(fullDateMatch[3]);
            targetDate = new Date(year, month, day);
        }
    }

    if (!targetDate) return null;

    // --- Time Parsing ---
    // Default to 9:00 AM if no time found
    targetDate.setHours(9, 0, 0, 0);

    // Look for time patterns: "at 15:30", "at 9", "15:30"
    // Regex for HH:MM
    const timeMatch = lowerText.match(/(?:alle|ore|a|at)\s+(\d{1,2})[:\.](\d{2})/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            targetDate.setHours(hours, minutes, 0, 0);
        }
    } else {
        // Regex for HH (only hours, e.g. "at 9")
        const hourMatch = lowerText.match(/(?:alle|ore|a|at)\s+(\d{1,2})(?!\d)/);
        if (hourMatch) {
            const hours = parseInt(hourMatch[1]);
            if (hours >= 0 && hours < 24) {
                targetDate.setHours(hours, 0, 0, 0);
            }
        }
    }

    return targetDate;
};

/**
 * Extract reminder information from user message
 * Returns null if no reminder request detected
 */
export const extractReminderRequest = (message: string): ReminderRequest | null => {
    const lowerMessage = message.toLowerCase();

    // Check if it's a reminder request
    const reminderKeywords = ['ricorda', 'ricordami', 'promemoria', 'reminder', 'segna', 'appunta'];
    const hasReminderKeyword = reminderKeywords.some(keyword => lowerMessage.includes(keyword));

    if (!hasReminderKeyword) {
        return null;
    }

    // Try to extract the date (and time)
    const when = parseNaturalDate(message);
    if (!when) {
        return null;
    }

    // Extract the "what" - text after keywords like "che", "di", "che devo"
    let what = message;

    // Remove the reminder keyword and date expressions
    reminderKeywords.forEach(keyword => {
        const regex = new RegExp(keyword + '[a-z]*', 'gi');
        what = what.replace(regex, '');
    });

    // Remove common connecting words
    what = what.replace(/\b(?:che|di|il|per|fra|tra|oggi|domani|dopodomani|that|to|the|for|in|today|tomorrow|after tomorrow)\b/gi, '');

    // Remove date patterns
    what = what.replace(/\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)/gi, '');
    what = what.replace(/\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{4})?/g, '');
    what = what.replace(/\d+\s+(?:giorn[oi]|days)/gi, '');
    what = what.replace(/\d+\s+(?:settiman[ae]|weeks)/gi, '');

    // Remove time patterns
    what = what.replace(/(?:alle|ore|a|at)\s+\d{1,2}[:\.]\d{2}/gi, ''); // HH:MM
    what = what.replace(/(?:alle|ore|a|at)\s+\d{1,2}/gi, ''); // HH

    what = what.trim();

    if (!what) {
        what = 'Reminder';
    }

    return {
        what,
        when
    };
};

/**
 * Create a reminder event from user request
 */
export const createReminder = async (request: ReminderRequest): Promise<boolean> => {
    const startDate = new Date(request.when);
    // Note: startDate already has the correct time from parseNaturalDate

    const endDate = new Date(startDate);
    endDate.setHours(startDate.getHours() + 1); // 1 hour duration

    const event: CalendarEvent = {
        title: request.what,
        notes: `Created by AI Mind Mesh`,
        startDate,
        endDate,
        location: request.location,
        isAllDay: false,
    };

    return await createCalendarEvent(event);
};
