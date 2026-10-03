/**
 * Pure helpers for the manual ("profile") memories kept in localStorage by useAppMemories.
 */

import { Memory } from '../../types';

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

/** Memories whose category is not in the list (deleted categories, older data): shown apart. */
export function uncategorizedMemories(memories: Memory[], categories: string[]): Memory[] {
    return memories.filter(m => !categories.includes(m.category || 'other'));
}

/**
 * Moves one memory when `idOrCategory` is a memory id, otherwise renames the category
 * (the settings list calls it with a memory id, older callers with a category name).
 */
export function updateCategory(
    memories: Memory[],
    categories: string[],
    idOrCategory: string,
    newCategory: string
): { memories: Memory[]; categories: string[] } {
    const target = normalizeCategory(newCategory);
    if (memories.some(m => m.id === idOrCategory)) {
        return {
            memories: memories.map(m => m.id === idOrCategory ? { ...m, category: target } : m),
            categories: withCategory(categories, target),
        };
    }
    return {
        memories: memories.map(m => m.category === idOrCategory ? { ...m, category: target } : m),
        categories: categories.includes(target)
            ? categories.filter(c => c !== idOrCategory)
            : categories.map(c => c === idOrCategory ? target : c),
    };
}

/**
 * Backup import: keeps existing memories, adds the imported ones that are not already there
 * (same id, or same text in the same category), re-ids those whose id is taken.
 */
export function mergeImportedMemories(existing: Memory[], imported: Memory[]): Memory[] {
    const ids = new Set(existing.map(m => m.id));
    const texts = new Set(existing.map(m => `${m.category}\u0000${m.content.trim()}`));
    const merged = [...existing];
    for (const memory of imported) {
        const text = `${memory.category}\u0000${memory.content.trim()}`;
        if (texts.has(text)) continue;
        const id = memory.id && !ids.has(memory.id) ? memory.id : newMemoryId();
        merged.push({ ...memory, id });
        ids.add(id);
        texts.add(text);
    }
    return merged;
}
