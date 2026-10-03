/**
 * Tracks which chat history the native LiteRT conversation was built from, so a new turn is
 * appended only to the same thread, exactly one exchange later (never to another thread's session).
 */
export interface NativeSessionSnapshot {
    /** id of the first message of the history the session was built from */
    firstId: string;
    /** id of the last message (the user turn) sent to the session */
    lastId: string;
    /** length of that history */
    length: number;
}

type IdentifiedMessage = { id: string };

export function snapshotOf(history: IdentifiedMessage[]): NativeSessionSnapshot | null {
    if (history.length === 0) return null;
    return { firstId: history[0].id, lastId: history[history.length - 1].id, length: history.length };
}

/**
 * True when `history` continues the session: same thread (first and last-sent ids match) and
 * exactly one reply plus one new message later. `nativeCount` > 0 means the session is alive.
 */
export function canAppendToSession(
    snapshot: NativeSessionSnapshot | null,
    history: IdentifiedMessage[],
    nativeCount: number
): boolean {
    if (!snapshot || nativeCount <= 0) return false;
    if (history.length !== snapshot.length + 2) return false;
    return history[0]?.id === snapshot.firstId && history[snapshot.length - 1]?.id === snapshot.lastId;
}
