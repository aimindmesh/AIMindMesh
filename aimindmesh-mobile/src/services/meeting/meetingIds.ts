let counter = 0;

/**
 * Segment ids are a global primary key in SQLite: Date.now() alone collided when two results
 * arrived in the same millisecond, and a collision made the whole meeting save fail.
 */
export function newSegmentId(prefix: string): string {
    counter = (counter + 1) % 1_000_000;
    const random = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${random}`;
}

export function newMeetingId(): string {
    return Date.now().toString();
}
