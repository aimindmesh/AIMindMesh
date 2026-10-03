import { beforeEach, describe, expect, it, vi } from 'vitest';

const ws = vi.hoisted(() => ({
  ensureInitialized: vi.fn(async () => { }),
  getContextMode: vi.fn(() => 'GLOBAL'),
  getActiveWorkspace: vi.fn((): any => null),
}));
const retriever = vi.hoisted(() => ({ autoRetrieve: vi.fn() }));
const db = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/workspaces/WorkspaceService', () => ({ workspaceService: ws }));
vi.mock('../src/services/documents/DocumentRetriever', () => ({ DocumentRetriever: class { autoRetrieve = retriever.autoRetrieve; } }));
vi.mock('../src/services/database/knowledgeDatabase', () => ({ getKnowledgeDatabase: async () => db }));

import { contextInjector } from '../src/services/llm/contextInjector';

const chunk = { id: 1, document_id: 7, document_title: 'Manual', content: 'The answer is 42', page_number: 3, score: 0.9 };

beforeEach(() => {
  ws.getContextMode.mockReturnValue('GLOBAL');
  ws.getActiveWorkspace.mockReturnValue(null);
  retriever.autoRetrieve.mockResolvedValue([chunk]);
  db.query.mockResolvedValue({ values: [{ 1: 1 }] });
});

describe('context injector', () => {
  it('searches all documents in global mode (no workspace)', async () => {
    const prompt = await contextInjector.buildSystemPromptWithContext('what is the answer?', 'BASE');
    expect(prompt.startsWith('BASE')).toBe(true);
    expect(prompt).toContain('WORKSPACE CONTEXT (All documents)');
    expect(prompt).toContain('The answer is 42');
  });

  it('skips retrieval when no document is indexed or context is disabled', async () => {
    db.query.mockResolvedValue({ values: [] });
    expect(await contextInjector.buildSystemPromptWithContext('q', 'BASE')).toBe('BASE');
    ws.getContextMode.mockReturnValue('NONE');
    expect(await contextInjector.buildSystemPromptWithContext('q', 'BASE')).toBe('BASE');
    expect(retriever.autoRetrieve).not.toHaveBeenCalled();
  });

  it('honours the auto-inject setting of the active workspace', async () => {
    ws.getContextMode.mockReturnValue('WORKSPACE');
    ws.getActiveWorkspace.mockReturnValue({ name: 'Work', settings: { auto_inject: false } });
    expect(await contextInjector.buildSystemPromptWithContext('q', 'BASE')).toBe('BASE');
    ws.getActiveWorkspace.mockReturnValue({ name: 'Work', settings: { auto_inject: true } });
    expect(await contextInjector.buildSystemPromptWithContext('q', 'BASE')).toContain('WORKSPACE CONTEXT (Work)');
  });
});
