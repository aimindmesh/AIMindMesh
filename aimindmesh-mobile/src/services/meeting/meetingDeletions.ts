/**
 * Meetings deleted while the app runs (in History or by sync). The meeting may still be open in
 * Meeting mode: its saves are refused so an autosave cannot recreate it, and listeners let the
 * screen reset. Segments deleted remotely are announced so an open transcript drops them too.
 */

export class MeetingDeletedError extends Error {
    constructor(public readonly meetingId: string) {
        super(`Meeting ${meetingId} was deleted`);
        this.name = 'MeetingDeletedError';
    }
}

const blocked = new Set<string>();
const deleted = new Set<string>();
const meetingListeners = new Set<(meetingId: string) => void>();
const segmentListeners = new Set<(segmentIds: Set<string>) => void>();

/** Saves are refused from now on; listeners are told only once the deletion has succeeded. */
export function blockMeetingSaves(meetingId: string): void {
    blocked.add(meetingId);
}

/** The deletion failed: the meeting can be saved again. */
export function unblockMeetingSaves(meetingId: string): void {
    blocked.delete(meetingId);
}

export function markMeetingDeleted(meetingId: string): void {
    blocked.delete(meetingId);
    deleted.add(meetingId);
    meetingListeners.forEach(listener => listener(meetingId));
}

export function isMeetingDeleted(meetingId: string): boolean {
    return deleted.has(meetingId) || blocked.has(meetingId);
}

export function onMeetingDeleted(listener: (meetingId: string) => void): () => void {
    meetingListeners.add(listener);
    return () => { meetingListeners.delete(listener); };
}

export function notifySegmentsDeleted(segmentIds: string[]): void {
    if (segmentIds.length === 0) return;
    const ids = new Set(segmentIds);
    segmentListeners.forEach(listener => listener(ids));
}

export function onSegmentsDeleted(listener: (segmentIds: Set<string>) => void): () => void {
    segmentListeners.add(listener);
    return () => { segmentListeners.delete(listener); };
}
