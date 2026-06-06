/**
 * Calendar Service
 * Service layer for Agenda functionality
 * Integrates internal database with optional System Calendar sync
 */

import { logger } from '../logger';
import * as CalendarDB from './calendarDatabase';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { CalendarPermissionScope } from '@ebarooni/capacitor-calendar/dist/esm/schemas/enums/calendar-permission-scope';

// Re-export types for convenience
export type { CalendarEvent, CalendarNote } from './calendarDatabase';

export interface AgendaSettings {
    defaultView: 'month' | 'day';
    showSystemCalendar: boolean;
}

export const DEFAULT_AGENDA_SETTINGS: AgendaSettings = {
    defaultView: 'month',
    showSystemCalendar: false,
};

// --- System Calendar Integration ---

/**
 * Check if system calendar permissions are granted
 */
export async function checkSystemCalendarPermissions(): Promise<boolean> {
    try {
        const response = await CapacitorCalendar.checkAllPermissions();
        const result = response.result;
        return result[CalendarPermissionScope.READ_CALENDAR] === 'granted' &&
            result[CalendarPermissionScope.WRITE_CALENDAR] === 'granted';
    } catch (error) {
        logger.log('error', '[CalendarService] Failed to check system calendar permissions', error);
        return false;
    }
}

/**
 * Request system calendar permissions
 */
export async function requestSystemCalendarPermissions(): Promise<boolean> {
    try {
        const response = await CapacitorCalendar.requestAllPermissions();
        const result = response.result;
        return result[CalendarPermissionScope.READ_CALENDAR] === 'granted' &&
            result[CalendarPermissionScope.WRITE_CALENDAR] === 'granted';
    } catch (error) {
        logger.log('error', '[CalendarService] Failed to request system calendar permissions', error);
        return false;
    }
}

/**
 * Get events from system calendar
 */
export async function getSystemCalendarEvents(startDate: Date, endDate: Date): Promise<CalendarDB.CalendarEvent[]> {
    try {
        const hasPermission = await checkSystemCalendarPermissions();
        if (!hasPermission) {
            const granted = await requestSystemCalendarPermissions();
            if (!granted) {
                logger.log('warn', '[CalendarService] System calendar permissions not granted');
                return [];
            }
        }

        const response = await CapacitorCalendar.listEventsInRange({
            from: startDate.getTime(),
            to: endDate.getTime(),
        });

        return response.result.map((event: any) => ({
            id: `sys_${event.id || Date.now()}`,
            title: event.title || 'Untitled Event',
            startTime: new Date(event.startDate),
            endTime: new Date(event.endDate),
            location: event.location,
            notes: event.description,
            isAllDay: event.isAllDay || false,
            isRecurring: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            isSystemEvent: true,
        }));
    } catch (error) {
        logger.log('error', '[CalendarService] Failed to get system calendar events', error);
        return [];
    }
}

/**
 * Add event to system calendar
 */
export async function addEventToSystemCalendar(event: Omit<CalendarDB.CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<boolean> {
    try {
        const hasPermission = await checkSystemCalendarPermissions();
        if (!hasPermission) {
            const granted = await requestSystemCalendarPermissions();
            if (!granted) {
                logger.log('warn', '[CalendarService] System calendar permissions not granted');
                return false;
            }
        }

        await CapacitorCalendar.createEvent({
            title: event.title,
            location: event.location,
            description: event.notes,
            startDate: event.startTime.getTime(),
            endDate: event.endTime.getTime(),
            isAllDay: event.isAllDay,
        });

        logger.log('info', '[CalendarService] Event added to system calendar');
        return true;
    } catch (error) {
        logger.log('error', '[CalendarService] Failed to add event to system calendar', error);
        return false;
    }
}

// --- Unified API (merges internal + system) ---

/**
 * Get all events for a date range (merged internal + optional system)
 */
export async function getAllEvents(
    startDate: Date,
    endDate: Date,
    includeSystem: boolean = false
): Promise<CalendarDB.CalendarEvent[]> {
    const internalEvents = await CalendarDB.getEvents(startDate, endDate);

    if (!includeSystem) {
        return internalEvents;
    }

    const systemEvents = await getSystemCalendarEvents(startDate, endDate);

    // Merge and sort by start time
    const allEvents = [...internalEvents, ...systemEvents];
    allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    return allEvents;
}

/**
 * Get all events and notes for a specific day
 */
export async function getDayAgenda(
    date: Date,
    includeSystem: boolean = false
): Promise<{
    events: CalendarDB.CalendarEvent[];
    notes: CalendarDB.CalendarNote[];
}> {
    // Create start and end of day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dateString = formatDateString(date);

    const events = await getAllEvents(startOfDay, endOfDay, includeSystem);
    const notes = await CalendarDB.getNotesForDate(dateString);

    return { events, notes };
}

/**
 * Get month data (events and notes indicators per day)
 */
export async function getMonthData(
    year: number,
    month: number,
    includeSystem: boolean = false
): Promise<Map<string, { hasEvents: boolean; hasNotes: boolean; eventCount: number; noteCount: number }>> {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const events = await getAllEvents(startDate, endDate, includeSystem);
    const notes = await CalendarDB.getNotesInRange(
        formatDateString(startDate),
        formatDateString(endDate)
    );

    const dayData = new Map<string, { hasEvents: boolean; hasNotes: boolean; eventCount: number; noteCount: number }>();

    // Process events
    for (const event of events) {
        const dateStr = formatDateString(event.startTime);
        const existing = dayData.get(dateStr) || { hasEvents: false, hasNotes: false, eventCount: 0, noteCount: 0 };
        existing.hasEvents = true;
        existing.eventCount++;
        dayData.set(dateStr, existing);
    }

    // Process notes
    for (const note of notes) {
        const existing = dayData.get(note.date) || { hasEvents: false, hasNotes: false, eventCount: 0, noteCount: 0 };
        existing.hasNotes = true;
        existing.noteCount++;
        dayData.set(note.date, existing);
    }

    return dayData;
}

// --- Helper Functions ---

/**
 * Format date as YYYY-MM-DD
 */
export function formatDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse date string (YYYY-MM-DD) to Date
 */
export function parseDateString(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Format time as HH:MM
 */
export function formatTimeString(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Get today's date string
 */
export function getTodayString(): string {
    return formatDateString(new Date());
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

/**
 * Check if two dates are the same day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
    return date1.getDate() === date2.getDate() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getFullYear() === date2.getFullYear();
}

/**
 * Get month name
 */
export function getMonthName(month: number): string {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[month];
}

/**
 * Get day name
 */
export function getDayName(dayOfWeek: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayOfWeek];
}

/**
 * Get short day names
 */
export function getShortDayNames(): string[] {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
}

// --- Export/Import Wrappers ---

export const exportAgendaData = CalendarDB.exportAgendaData;
export const importAgendaData = CalendarDB.importAgendaData;
export const clearAllAgendaData = CalendarDB.clearAllAgendaData;
export const getAgendaStats = CalendarDB.getAgendaStats;
export const initCalendarDatabase = CalendarDB.initCalendarDatabase;

// --- CRUD Wrappers ---

export const addEvent = CalendarDB.addEvent;
export const updateEvent = CalendarDB.updateEvent;
export const deleteEvent = CalendarDB.deleteEvent;
export const getEventById = CalendarDB.getEventById;

export const addNote = CalendarDB.addNote;
export const updateNote = CalendarDB.updateNote;
export const deleteNote = CalendarDB.deleteNote;
export const getNotesForDate = CalendarDB.getNotesForDate;

export const searchAgenda = CalendarDB.searchAgenda;
