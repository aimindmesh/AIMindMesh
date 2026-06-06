/**
 * Meeting Briefing Service
 * 
 * Generates contextual meeting briefings 5 minutes before calendar events.
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

// Track sent briefings to prevent duplicates
const sentBriefings = new Set<string>();

/**
 * Check upcoming events and determine which need a briefing.
 * Returns events that are within the briefing window and haven't been briefed yet.
 */
export function getEventsPendingBriefing(
    upcomingEvents: CalendarEvent[],
    leadTimeMinutes: number = 5,
    now: number = Date.now()
): CalendarEvent[] {
    const leadTimeMs = leadTimeMinutes * 60 * 1000;

    return upcomingEvents.filter(event => {
        // Already briefed?
        if (sentBriefings.has(event.id)) return false;

        // Is the event within the briefing window?
        const timeUntil = event.start - now;
        return timeUntil > 0 && timeUntil <= leadTimeMs;
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
 * Mark an event as briefed (prevents duplicate briefings).
 */
export function markEventBriefed(eventId: string): void {
    sentBriefings.add(eventId);
    logger.log('info', `[MeetingBriefing] Marked event ${eventId} as briefed`);

    // Cleanup old entries after 24 hours
    setTimeout(() => sentBriefings.delete(eventId), 24 * 60 * 60 * 1000);
}

/**
 * Check if an event has already been briefed.
 */
export function isEventBriefed(eventId: string): boolean {
    return sentBriefings.has(eventId);
}
