/**
 * Meeting Briefing Service
 *
 * Generates contextual meeting briefings shortly before calendar events.
 * Uses RAG + semantic memories to build relevant context, then produces
 * a concise briefing via the active LLM.
 *
 * Integration: called by ProactiveService during handlePeriodicCheck().
 */

import { logger } from '../logger';

// Interface for calendar events (from ContextAnalyzer)
export interface CalendarEvent {
    id: string;
    title: string;
    start: number;   // timestamp ms
    end?: number;
    location?: string;
    notes?: string;
    attendees?: string[];
}

/** Agenda event as the calendar database returns it */
interface AgendaEventLike {
    id: string;
    title: string;
    startTime: Date;
    endTime?: Date;
    location?: string;
    notes?: string;
    isAllDay?: boolean;
}

/**
 * Period of the proactive checks (the native WorkManager job runs every 15 minutes at best).
 * The briefing window must be at least this long, or most events fall between two checks.
 */
export const CHECK_PERIOD_MINUTES = 15;

const BRIEFED_KEY = 'proactive-briefed-events';
const BRIEFED_TTL_MS = 24 * 60 * 60 * 1000;

/** Briefed event ids with the time they were briefed (kept across restarts, for 24 hours) */
function readBriefed(now: number = Date.now()): Record<string, number> {
    try {
        const stored = JSON.parse(localStorage.getItem(BRIEFED_KEY) || '{}');
        const fresh: Record<string, number> = {};
        for (const [id, at] of Object.entries(stored)) {
            if (typeof at === 'number' && now - at < BRIEFED_TTL_MS) fresh[id] = at;
        }
        return fresh;
    } catch {
        return {};
    }
}

/**
 * Agenda events in the shape the briefing works with. All-day events are not meetings.
 */
export function toBriefingEvents(events: AgendaEventLike[]): CalendarEvent[] {
    return events
        .filter(e => !e.isAllDay && e.startTime instanceof Date)
        .map(e => ({
            id: e.id,
            title: e.title,
            start: e.startTime.getTime(),
            end: e.endTime?.getTime(),
            location: e.location,
            notes: e.notes,
        }));
}

/**
 * Check upcoming events and determine which need a briefing.
 * Returns events starting within the lead time plus one check period that haven't been
 * briefed yet: each event is caught by exactly one check, between `leadTimeMinutes` and
 * `leadTimeMinutes + CHECK_PERIOD_MINUTES` before it starts.
 */
export function getEventsPendingBriefing(
    upcomingEvents: CalendarEvent[],
    leadTimeMinutes: number = 5,
    now: number = Date.now()
): CalendarEvent[] {
    const windowMs = (Math.max(0, leadTimeMinutes) + CHECK_PERIOD_MINUTES) * 60 * 1000;
    const briefed = readBriefed(now);

    return upcomingEvents.filter(event => {
        // Already briefed?
        if (briefed[event.id]) return false;

        // Is the event within the briefing window?
        const timeUntil = event.start - now;
        return timeUntil > 0 && timeUntil <= windowMs;
    });
}

/**
 * Build a structured prompt for the LLM to generate a meeting briefing.
 */
export function buildBriefingPrompt(event: CalendarEvent): string {
    const parts: string[] = [];

    parts.push(`Meeting: "${event.title}"`);
    parts.push(`Time: ${new Date(event.start).toLocaleTimeString()}`);

    if (event.location) {
        parts.push(`Location: ${event.location}`);
    }

    if (event.attendees && event.attendees.length > 0) {
        parts.push(`Attendees: ${event.attendees.join(', ')}`);
    }

    if (event.notes) {
        parts.push(`Notes: ${event.notes}`);
    }

    parts.push('');
    parts.push('Please provide a concise meeting briefing including:');
    parts.push('1. Key context about this meeting');
    parts.push('2. Suggested talking points');
    parts.push('3. Any preparation needed');

    return parts.join('\n');
}

/**
 * Mark an event as briefed (prevents duplicate briefings, also after a restart).
 */
export function markEventBriefed(eventId: string, now: number = Date.now()): void {
    const briefed = readBriefed(now);
    briefed[eventId] = now;
    try {
        localStorage.setItem(BRIEFED_KEY, JSON.stringify(briefed));
    } catch {
        // Storage full: the event may be briefed once more, nothing worse
    }
    logger.log('info', `[MeetingBriefing] Marked event ${eventId} as briefed`);
}

/**
 * Check if an event has already been briefed.
 */
export function isEventBriefed(eventId: string): boolean {
    return !!readBriefed()[eventId];
}
