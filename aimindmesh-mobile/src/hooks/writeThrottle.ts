/**
 * Writes at most once per interval: the first change is written at once, later changes
 * inside the interval are coalesced into one trailing write of the newest value.
 * Keeps single edits immediate while a streaming chat (about 10 updates per second)
 * is not serialized to storage on every update.
 */
export function createWriteThrottle<T>(write: (value: T) => void, intervalMs: number) {
    let lastWrite = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { value: T } | null = null;

    const writePending = () => {
        timer = null;
        if (!pending) return;
        const { value } = pending;
        pending = null;
        lastWrite = Date.now();
        write(value);
    };

    return {
        push(value: T) {
            const now = Date.now();
            if (!timer && now - lastWrite >= intervalMs) {
                pending = null;
                lastWrite = now;
                write(value);
                return;
            }
            pending = { value };
            if (!timer) timer = setTimeout(writePending, Math.max(0, intervalMs - (now - lastWrite)));
        },
        /** Writes a pending value now (app going to background, component unmounting) */
        flush() {
            if (timer) clearTimeout(timer);
            writePending();
        },
    };
}
