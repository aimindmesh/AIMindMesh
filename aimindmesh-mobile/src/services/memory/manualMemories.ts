/**
 * Small helpers shared by the facts store and the memory settings: ids and category labels.
 */

let idCounter = 0;

/**
 * Unique id. Date.now() alone collided when several memories were saved in the same
 * millisecond (two <save_memory> tags in one reply), and deleting one deleted both.
 */
export function newMemoryId(): string {
    const cryptoApi = (globalThis as any).crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    idCounter = (idCounter + 1) % 1_000_000;
    return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const normalizeCategory = (category: string | undefined | null): string =>
    (typeof category === 'string' && category.trim()) ? category.trim() : 'other';

/** Categories with `category` added when missing (memories in unlisted categories were invisible). */
export function withCategory(categories: string[], category: string): string[] {
    return categories.includes(category) ? categories : [...categories, category];
}
