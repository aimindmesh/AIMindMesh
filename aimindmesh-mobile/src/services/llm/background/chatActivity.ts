/**
 * What the user is doing with the chat, outside React: background work (memory consolidation,
 * proactive messages) runs only when no answer is being generated and the chat has been quiet
 * for a while. Generations are counted (an agentic run makes several calls).
 */

let active = 0;
let lastActivityAt = 0;
const listeners = new Set<() => void>();

function touch(): void {
    lastActivityAt = Date.now();
    listeners.forEach(cb => cb());
}

/** A user message or a foreground generation starts: returns the matching end (idempotent). */
export function beginChatActivity(): () => void {
    active++;
    touch();
    let ended = false;
    return () => {
        if (ended) return;
        ended = true;
        active = Math.max(0, active - 1);
        touch();
    };
}

/** The user did something in the chat without a generation (e.g. opened a thread). */
export function noteChatActivity(): void {
    touch();
}

export function isChatGenerating(): boolean {
    return active > 0;
}

/** Time of the last chat activity (0: none since the app started). */
export function getLastChatActivityAt(): number {
    return lastActivityAt;
}

/** True when nothing is generating and the chat has been quiet for at least `ms`. */
export function isChatIdleFor(ms: number, now: number = Date.now()): boolean {
    return active === 0 && now - lastActivityAt >= ms;
}

/** Called on every activity change (start, end, note). */
export function onChatActivity(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/** Test hook */
export function resetChatActivity(): void {
    active = 0;
    lastActivityAt = 0;
    listeners.clear();
}
