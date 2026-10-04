import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/memory/semanticMemoryRetriever', () => ({
    getOrInitializeSemanticMemoryRetriever: async () => ({
        retrieveRelevantMemories: mocks.retrieve,
        truncateToTokenLimit: (found: unknown[]) => found,
    }),
}));
vi.mock('../src/services/llm/contextInjector', () => ({ contextInjector: { buildSystemPromptWithContext: async () => '' } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({ ensureEmbeddingModel: async () => false }));

import { cleanSubject, hasRelativeDate, inlineFactsToSave, rejectFact } from '../src/services/memory/facts/factQuality';
import { isRecallQuestion, RECALL_INSTRUCTION, recallFacts, redirectRecallToolCall } from '../src/services/memory/context/recallQuestion';
import { validateOps } from '../src/services/memory/facts/factConsolidator';
import { withReasoningAllowance } from '../src/services/llm/context/unifiedContextManager';
import { buildPromptContext } from '../src/services/llm/promptContext';
import { executeSearchMemory } from '../src/services/tools/memoryTools';
import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import type { Fact } from '../src/services/memory/facts/factTypes';
import type { LLMConfig, Message } from '../src/types';

const msg = (id: string, text: string): Message => ({ id, role: 'user', text, timestamp: new Date() });
const fact = (id: string, content: string, importance = 3): Fact =>
    ({ id, content, importance, kind: 'other', status: 'active', pinned: false, updatedAt: Number(id), createdAt: 1 } as Fact);

describe('fact quality', () => {
    it('rejects what on-device models saved on the Fold7', () => {
        expect(rejectFact("L'utente ha chiesto un'informazione sui gatti.")).toBe('question');
        expect(rejectFact('The user asked about a curiosity regarding dogs.')).toBe('question');
        expect(rejectFact("User's current location: I need to remember this fact.*")).toBe('meta');
        expect(rejectFact('Dove abita?')).toBe('question');
        expect(rejectFact('ok')).toBe('too-short');
        expect(rejectFact('The assistant suggested a route')).toBe('about-assistant');
        expect(rejectFact("L'utente ha menzionato Marco.")).toBe('meta');
        expect(rejectFact('The user mentioned a trip')).toBe('meta');
        expect(rejectFact("L'utente ha parlato del viaggio in Sardegna con la moglie")).toBe('meta');
    });

    it('keeps real facts about the user', () => {
        for (const ok of ['Vive a Varese con la moglie Giulia', 'Ha una sorella di nome Anna', 'Fa yoga ogni sabato', 'Works as a nurse']) {
            expect(rejectFact(ok)).toBeNull();
        }
        expect(cleanSubject('User')).toBeUndefined();
        expect(cleanSubject("l'utente")).toBeUndefined();
        expect(cleanSubject('Anna')).toBe('Anna');
    });

    it('leaves plans with relative dates to the consolidation', () => {
        expect(hasRelativeDate('The user plans to run 8 km tomorrow morning at the park')).toBe(true);
        expect(hasRelativeDate('Vuole fare un giro in bici sabato')).toBe(true);
        expect(hasRelativeDate('Fa yoga ogni sabato')).toBe(false);
        const { save, skipped } = inlineFactsToSave(['Ha una sorella di nome Anna', 'Domani corre 8 km', "User's location: I need to remember this fact.*"]);
        expect(save).toEqual(['Ha una sorella di nome Anna']);
        expect(skipped.map(s => s.reason)).toEqual(['relative-date', 'meta']);
    });

    it('the consolidation drops trivia, questions and undated relative plans, and cleans the subject', () => {
        const ops = validateOps([
            { op: 'add', kind: 'other', content: "L'utente ha chiesto un'informazione sui gatti.", importance: 1 },
            { op: 'add', kind: 'preference', content: 'Ama il caffè amaro', importance: 1 },
            { op: 'add', kind: 'event', content: 'Giro in bici sul lago Maggiore sabato', importance: 3 },
            { op: 'add', kind: 'event', content: 'Giro in bici sul lago Maggiore sabato', importance: 3, due: '2026-10-10' },
            { op: 'add', kind: 'identity', content: 'Lavora come sviluppatore software', importance: 4, subject: 'User' },
        ], []);
        expect(ops.map(o => [o.content, o.subject, o.dueAt !== undefined])).toEqual([
            ['Giro in bici sul lago Maggiore sabato', undefined, true],
            ['Lavora come sviluppatore software', undefined, false],
        ]);
    });
});

describe('answer budget', () => {
    it('adds room for the reasoning the prompt asks for', () => {
        expect(withReasoningAllowance(250, {})).toBe(250);
        expect(withReasoningAllowance(250, { enableThinking: true })).toBe(762);
        expect(withReasoningAllowance(250, { enableToolCalling: true, thinkingBudget: 300 })).toBe(550);
    });
});

describe('recall questions', () => {
    it('recognizes questions about what the assistant knows of the user', () => {
        for (const q of ['Ricordi dove abito?', 'Ti ricordi come si chiama mia sorella?', 'Cosa sai di me?', 'Sai dove lavoro?',
            'Ti ho detto quando è il mio compleanno?', 'Do you remember my dog?', 'Where do I live?', "What's my wife's name?"]) {
            expect(isRecallQuestion(q)).toBe(true);
        }
        for (const q of ['Che tempo fa a ottobre sul lago Maggiore?', 'Dammi un consiglio per la corsa', 'Write a poem']) {
            expect(isRecallQuestion(q)).toBe(false);
        }
    });

    it('a web search for a recall question searches the memory instead', () => {
        expect(redirectRecallToolCall({ name: 'search_web', args: { query: 'user location' }, id: 'c1' }, 'Ricordi dove abito?'))
            .toEqual({ name: 'search_memory', args: { query: 'Ricordi dove abito?' }, id: 'c1' });
        const weather = { name: 'search_web', args: { query: 'meteo' } };
        expect(redirectRecallToolCall(weather, 'Che tempo fa domani?')).toBe(weather);
        const todo = { name: 'create_task', args: {} };
        expect(redirectRecallToolCall(todo, 'Ricordi dove abito?')).toBe(todo);
    });

    it('a question with no word in common still sees the most important facts', () => {
        const all = [fact('1', 'Corre a Cardano al Campo', 3), fact('2', 'Ha un gatto', 2), fact('3', 'Lavora come sviluppatore', 5), fact('4', 'In profile', 5)];
        expect(recallFacts([], all, new Set(['4']), 2).map(f => f.content)).toEqual(['Lavora come sviluppatore', 'Corre a Cardano al Campo']);
        expect(recallFacts([all[1]], all, new Set(['4']), 2).map(f => f.content)).toEqual(['Ha un gatto', 'Lavora come sviluppatore']);
    });

    it('search_memory with no word in common returns what is known, saying it is not about the question', async () => {
        factStore.resetForTests();
        await factStore.init(new LocalFactRepository());
        expect((await executeSearchMemory({ query: 'Ricordi dove abito?' })).message).toBe('No memory about this: the user has not told you yet.');
        await factStore.add({ content: 'Corre spesso al parco del paese', kind: 'routine' });
        const result = await executeSearchMemory({ query: 'Ricordi dove abito?' });
        expect(result.message).toMatch(/^Nothing about this exactly: the user has not told you\. What you know about them:\n\[.+\] \(.+\) Corre spesso al parco del paese$/);
        expect((await executeSearchMemory({ query: 'parco' })).message).toMatch(/Corre spesso al parco/);
    });

    it('a recall question gets a looser memory search and the instruction next to the question', async () => {
        factStore.resetForTests();
        await factStore.init(new LocalFactRepository());
        await factStore.add({ content: 'Corre spesso al parco del paese', kind: 'routine' });
        mocks.retrieve.mockResolvedValue([{ content: 'Domani vado a correre al parco', role: 'user', similarity: 0.62, timestamp: Date.UTC(2026, 9, 4) }]);
        const config = { provider: 'gemini', enableSemanticMemory: true, embeddingModelId: 'm' } as LLMConfig;
        const persona = { name: 'Ada', description: 'friend', systemPrompt: 'Be kind.', traits: [] };

        const recall = await buildPromptContext({ personality: persona, llmConfig: config, history: [msg('1', 'Ricordi dove abito?')] });
        expect(mocks.retrieve).toHaveBeenLastCalledWith('Ricordi dove abito?', undefined, 5, 0.6, undefined);
        expect(recall.systemPrompt).toContain('Corre spesso al parco del paese');
        expect(recall.turnContext).toContain('Domani vado a correre al parco');
        expect(recall.turnContext.endsWith(RECALL_INSTRUCTION)).toBe(true);

        const normal = await buildPromptContext({ personality: persona, llmConfig: config, history: [msg('2', 'Che tempo fa?')] });
        expect(mocks.retrieve).toHaveBeenLastCalledWith('Che tempo fa?', undefined, 3, 0.75, undefined);
        expect(normal.turnContext).not.toContain('ASKING WHAT YOU REMEMBER');
    });
});

beforeEach(() => mocks.retrieve.mockReset());
