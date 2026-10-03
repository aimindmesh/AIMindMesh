import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    activeWorkspaceRows: [] as any[],
    runs: [] as Array<{ sql: string; values: any[] }>,
    sets: [] as Array<Array<{ statement: string; values: any[] }>>,
    failSetAt: -1,
    server: null as any,
}));

const fakeDb = {
    query: vi.fn(async (sql: string) => ({ values: /is_active = 1/.test(sql) ? state.activeWorkspaceRows : [] })),
    run: vi.fn(async (sql: string, values: any[] = []) => {
        state.runs.push({ sql, values });
        return { changes: { changes: 1, lastId: /INSERT INTO documents/.test(sql) ? 7 : 0 } };
    }),
    execute: vi.fn(async () => ({ changes: { changes: 0 } })),
    executeSet: vi.fn(async (set: Array<{ statement: string; values: any[] }>) => {
        if (state.sets.length === state.failSetAt) throw new Error('disk full');
        state.sets.push(set);
        return { changes: { changes: set.length } };
    }),
};

vi.mock('../src/services/database/knowledgeDatabase', () => ({
    getKnowledgeDatabase: async () => fakeDb,
    INGESTING_CHUNK_COUNT: -1,
}));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/documents/DocumentParser', () => ({
    DocumentParser: class { async parse() { return 'Some document text long enough to index.'; } },
}));
vi.mock('../src/utils/fileSystemAdapter', () => ({
    FileSystemAdapter: {
        stat: async () => ({ size: 100 }),
        readFile: async () => ({ data: btoa('file bytes') }),
    },
}));
vi.mock('../src/services/security/secretStore', () => ({
    readSetting: (key: string, fallback: unknown) => (key === 'aimindmesh-server-settings' ? state.server : fallback),
}));
vi.mock('../src/services/llm/llmService', () => ({ generateTextResponseStream: async function* () { /* unused */ } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({
    ensureEmbeddingModel: async () => true,
    ensureEmbeddingModelFromSettings: async () => true,
    getActiveEmbeddingModel: () => ({ modelId: 'm', key: 'm#v2', dimension: 2 }),
    getEmbeddingLoadError: () => null,
    embedText: async () => ({ vector: new Float32Array([1, 0]), key: 'm#v2' }),
}));

import { WorkspaceService } from '../src/services/workspaces/WorkspaceService';
import { DocumentIngestionService } from '../src/services/documents/DocumentIngestionService';

const chunks = (n: number) => Array.from({ length: n }, (_, i) => ({ content: `chunk ${i}`, chunk_index: i }));
const embeddings = (n: number) => Array.from({ length: n }, () => new Float32Array([1, 0]));

describe('workspace context mode', () => {
    beforeEach(() => {
        state.activeWorkspaceRows = [];
    });

    it('keeps "No workspace" across restarts', async () => {
        await new WorkspaceService().disableContext();

        const restarted = new WorkspaceService();
        await restarted.ensureInitialized();
        expect(restarted.getContextMode()).toBe('NONE');

        await restarted.setGlobalContext();
        const again = new WorkspaceService();
        await again.ensureInitialized();
        expect(again.getContextMode()).toBe('GLOBAL');
    });

    it('prefers the active workspace row', async () => {
        localStorage.setItem('workspace-context-mode', 'NONE');
        state.activeWorkspaceRows = [{ id: 3, name: 'Thesis', settings: null, is_active: 1 }];
        const service = new WorkspaceService();
        await service.ensureInitialized();
        expect(service.getContextMode()).toBe('WORKSPACE');
        expect(service.getActiveWorkspace()?.id).toBe(3);
    });

    it('refuses to link a document that has no local row', async () => {
        await expect(new WorkspaceService().addDocumentToWorkspace(1, -1)).rejects.toThrow('server');
    });
});

describe('document ingestion', () => {
    beforeEach(() => {
        state.runs = [];
        state.sets = [];
        state.failSetAt = -1;
        state.server = null;
    });

    it('writes chunks in batches with the model key and finalizes the document last', async () => {
        const id = await new DocumentIngestionService().saveToDatabase({ name: 'a.txt', path: '/a.txt', type: 'txt', size: 1 }, chunks(120), embeddings(120), {}, 'm#v2');
        expect(id).toBe(7);
        expect(state.runs[0].values[5]).toBe(-1); // marked as being ingested
        expect(state.sets.map(s => s.length)).toEqual([50, 50, 20]);
        expect(state.sets[0][0].values[state.sets[0][0].values.length - 1]).toBe('m#v2');
        expect(state.runs[state.runs.length - 1]).toEqual({ sql: 'UPDATE documents SET total_chunks = ? WHERE id = ?', values: [120, 7] });
    });

    it('removes the document when a batch fails', async () => {
        state.failSetAt = 1;
        await expect(new DocumentIngestionService().saveToDatabase({ name: 'a.txt', path: '/a.txt', type: 'txt', size: 1 }, chunks(120), embeddings(120), {}, 'm#v2'))
            .rejects.toThrow('disk full');
        expect(state.runs[state.runs.length - 1]).toEqual({ sql: 'DELETE FROM documents WHERE id = ?', values: [7] });
    });

    it('reports server ingestion as remote, without a local id', async () => {
        state.server = { enabled: true, serverUrl: 'http://srv', apiKey: 'k' };
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ jobId: 'job-1' }) })));
        const result = await new DocumentIngestionService().ingestDocument('/docs/a.txt');
        expect(result).toMatchObject({ id: -1, status: 'indexed', remote: true, jobId: 'job-1' });
        vi.unstubAllGlobals();
    });
});
