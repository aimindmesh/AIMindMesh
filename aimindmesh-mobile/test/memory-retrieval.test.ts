import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'm#v2';
const db = vi.hoisted(() => ({
    vectors: [] as Array<{ id: string; sessionId: string; embedding: Float32Array }>,
    rows: [] as Array<{ id: string; sessionId: string; timestamp: number; role: string; content: string }>,
    getMemoryEmbeddings: vi.fn(),
    saveMemoryToDb: vi.fn(),
}));

vi.mock('text-embedding-capacitor', () => ({ TextEmbedding: {} }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/memory/memoryGraph', () => ({
    getMemoryGraphService: () => ({ findRelatedMemories: async () => [], detectRelations: async () => [] }),
}));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({
    ensureEmbeddingModel: async () => true,
    getActiveEmbeddingModel: () => ({ modelId: 'm', key: KEY, dimension: 2 }),
    getEmbeddingLoadError: () => null,
    unloadEmbeddingModel: async () => undefined,
    // The query points along x
    embedText: async () => ({ vector: new Float32Array([1, 0]), key: KEY }),
}));
vi.mock('../src/services/memory/memoryDatabase', () => ({
    getMemoryDatabase: async () => ({}),
    pruneOldMemories: async () => 0,
    getRecentMemories: async () => [],
    saveMemoryToDb: db.saveMemoryToDb,
    getMemoryEmbeddings: db.getMemoryEmbeddings,
    getMemoriesByIds: async (ids: string[]) => db.rows.filter(r => ids.includes(r.id)),
}));

import { SemanticMemoryRetriever } from '../src/services/memory/semanticMemoryRetriever';
import { isSelfMatch } from '../src/services/memory/selfMatch';

const QUERY = 'What did I tell you about my trip to Rome?';
const row = (id: string, content: string, role = 'user') => ({ id, sessionId: 's', timestamp: 1, role, content });

describe('semantic memory retrieval', () => {
    beforeEach(() => {
        // Just-saved query (identical vector), then two real memories
        db.vectors = [
            { id: 'q', sessionId: 's', embedding: new Float32Array([1, 0]) },
            { id: 'fact', sessionId: 's', embedding: new Float32Array([0.9, 0.3]) },
            { id: 'older', sessionId: 's', embedding: new Float32Array([0.8, 0.5]) },
        ];
        db.rows = [row('q', ` ${QUERY.toUpperCase()} `), row('fact', 'User is flying to Rome on May 3rd', 'extracted'), row('older', 'Rome hotel booked near Termini')];
        db.getMemoryEmbeddings.mockReset().mockImplementation(async () => db.vectors);
        db.saveMemoryToDb.mockReset();
    });

    it('never returns the message being answered as a memory', async () => {
        const retriever = new SemanticMemoryRetriever();
        expect(await retriever.initialize('m')).toBe(true);
        const results = await retriever.retrieveRelevantMemories(QUERY, undefined, 2, 0.5);
        expect(results.map(r => r.id)).toEqual(['fact', 'older']);
        // Only vectors of the active model are scored
        expect(db.getMemoryEmbeddings).toHaveBeenCalledWith(30, KEY);
    });

    it('stores new memories with the model key and returns their id', async () => {
        const retriever = new SemanticMemoryRetriever();
        await retriever.initialize('m');
        const id = await retriever.saveMessage('s', 'user', 'I am planning a trip to Rome next month');
        expect(id).toBeTruthy();
        expect(db.saveMemoryToDb).toHaveBeenCalledWith(id, 's', 'user', 'I am planning a trip to Rome next month', expect.any(Float32Array), KEY);
    });

    it('compares texts ignoring case and spacing', () => {
        expect(isSelfMatch('  hello   World ', 'hello world')).toBe(true);
        expect(isSelfMatch('hello world!', 'hello world')).toBe(false);
    });
});
