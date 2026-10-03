/**
 * The chat saves the user's message to semantic memory before generating the reply, so the
 * message is in the database when its own retrieval runs and would come back as the top
 * "memory" (similarity ~1.0). A memory with the same text as the query adds nothing.
 */
export const normalizeMemoryText = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

export function isSelfMatch(memoryContent: string, query: string): boolean {
    return normalizeMemoryText(memoryContent) === normalizeMemoryText(query);
}

/** Drops self matches, keeps order, returns at most `max` items. */
export function withoutSelfMatches<T extends { content: string }>(items: T[], query: string, max: number): T[] {
    return items.filter(item => !isSelfMatch(item.content, query)).slice(0, max);
}
