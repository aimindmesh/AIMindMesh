/**
 * The prompt context of a user turn is computed once per agent run: every tool step used to
 * search the memory again, and a different answer (a fact touched meanwhile, a new ranking)
 * changed the user turn, so the engine's KV cache was lost from there on. While a run holds the
 * cache, the same turn gets the same context; it is dropped when the run ends.
 */
let holders = 0;
const cache = new Map<string, Promise<unknown>>();

/** Held by the agent runner for the duration of a run; returns the release */
export function holdTurnContext(): () => void {
    holders++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (--holders === 0) cache.clear();
    };
}

/** The value for `key` computed once while a run holds the cache; computed every time otherwise */
export function cachedForTurn<T>(key: string, build: () => Promise<T>): Promise<T> {
    if (holders === 0) return build();
    let value = cache.get(key) as Promise<T> | undefined;
    if (!value) {
        value = build();
        cache.set(key, value);
        value.catch(() => cache.delete(key)); // a failure is retried at the next step
    }
    return value;
}
