import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(async () => 'id') }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/background/backgroundLlm', () => ({ runBackgroundTask: mocks.run }));
vi.mock('../src/services/memory/semanticMemoryRetriever', () => ({
    getOrInitializeSemanticMemoryRetriever: async () => ({ saveMessage: mocks.save }),
}));

import { buildEpisodePrompt, episodeText, recordEpisode } from '../src/services/memory/episodes/episodeSummary';
import { memoryThresholds } from '../src/services/memory/context/memoryThresholds';
import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import type { LLMConfig, Message } from '../src/types';

const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, timestamp: new Date() });
const config = { enableSemanticMemory: true, embeddingModelId: 'multilingual-e5-small' } as LLMConfig;
const talk = [
    msg('1', 'user', 'Sto pensando di cambiare macchina, la mia ha quindici anni'),
    msg('2', 'model', 'Che tipo di auto ti interessa?'),
    msg('3', 'user', 'Una ibrida, per andare al lavoro a Varese tutti i giorni'),
];

beforeEach(async () => {
    mocks.run.mockReset();
    mocks.save.mockClear();
    localStorage.clear();
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
});

describe('episode summaries', () => {
    it('asks for a short third-person summary in the assistant language', () => {
        const prompt = buildEpisodePrompt(talk, 'it');
        expect(prompt).toContain('Utente: Una ibrida, per andare al lavoro a Varese tutti i giorni');
        expect(prompt).toContain('Assistente: Che tipo di auto ti interessa?');
        expect(prompt).toMatch(/scrivi solo: NIENTE$/);
        expect(episodeText('NIENTE')).toBeNull();
        expect(episodeText('  L\'utente vuole cambiare la sua auto di quindici anni con una ibrida.  ')).toBe("L'utente vuole cambiare la sua auto di quindici anni con una ibrida.");
    });

    it('stores one summary row per stretch, then waits for new messages', async () => {
        mocks.run.mockResolvedValue({ text: "L'utente vuole un'auto ibrida per andare al lavoro a Varese." });
        expect(await recordEpisode('t1', talk, 'it', config)).toBe('done');
        expect(mocks.save).toHaveBeenCalledWith('t1', 'system', "[MEMORY SUMMARY] L'utente vuole un'auto ibrida per andare al lavoro a Varese.");
        expect(await recordEpisode('t1', talk, 'it', config)).toBe('done');
        expect(mocks.run).toHaveBeenCalledTimes(1);
    });

    it('a short exchange waits; a busy model retries later', async () => {
        expect(await recordEpisode('t2', [msg('a', 'user', 'Ciao!')], 'it', config)).toBe('done');
        expect(mocks.run).not.toHaveBeenCalled();
        mocks.run.mockResolvedValue({ text: null, skipped: 'chat_active' });
        expect(await recordEpisode('t3', talk, 'it', config)).toBe('retry');
        expect(mocks.save).not.toHaveBeenCalled();
    });
});

describe('memory thresholds', () => {
    it('follow the embedding model, unless set by hand', () => {
        expect(memoryThresholds({ embeddingModelId: 'multilingual-e5-small' })).toEqual({ related: 0.82, recall: 0.81 });
        expect(memoryThresholds({ embeddingModelId: 'all-MiniLM-L6-v2' }).related).toBe(0.5);
        expect(memoryThresholds({ embeddingModelId: 'custom' })).toEqual({ related: 0.75, recall: 0.6 });
        expect(memoryThresholds({ embeddingModelId: 'multilingual-e5-small', semanticMemorySimilarityThreshold: 0.8 })).toEqual({ related: 0.8, recall: 0.78 });
    });
});
