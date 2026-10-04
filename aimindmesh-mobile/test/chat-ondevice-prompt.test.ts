import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/memory/semanticMemoryRetriever', () => ({
    getOrInitializeSemanticMemoryRetriever: async () => ({
        retrieveRelevantMemories: async () => [{ content: 'Il mio cane si chiama Pepe', role: 'user', similarity: 0.9, timestamp: Date.UTC(2026, 8, 20) }],
        truncateToTokenLimit: (found: unknown[]) => found,
    }),
}));
vi.mock('../src/services/llm/contextInjector', () => ({ contextInjector: { buildSystemPromptWithContext: async () => '' } }));
vi.mock('../src/services/model/embedding/embeddingRuntime', () => ({ ensureEmbeddingModel: async () => false }));

import { buildPromptContext, historyWithTurnContext } from '../src/services/llm/promptContext';
import { buildOnDeviceSystemPrompt, withLanguageRule } from '../src/services/llm/prompt/onDevicePrompt';
import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import type { LLMConfig, Message, Personality } from '../src/types';

const atlas: Personality = { name: 'Atlas', description: 'professional', systemPrompt: 'You are Atlas, a professional AI assistant.', traits: ['Professional', 'Efficient'] };
const msg = (text: string): Message => ({ id: 'u1', role: 'user', text, timestamp: new Date() });
const config = { provider: 'genie-npu', enableSemanticMemory: true, embeddingModelId: 'm', nCtx: 4096 } as LLMConfig;

beforeEach(async () => {
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
    await factStore.add({ content: 'Vive a Gallarate', kind: 'identity', importance: 5 });
});

describe('on-device prompt', () => {
    it('is compact, in the user language, without the inline memory rule or the companion rules', async () => {
        const ctx = await buildPromptContext({ personality: atlas, llmConfig: config, history: [msg('Che tempo fa domani?')], onDevice: true });
        expect(ctx.language).toBe('it');
        expect(ctx.systemPrompt).toMatch(/^Sei Atlas, l'assistente personale dell'utente\. You are Atlas/);
        expect(ctx.systemPrompt).toContain("COSA SAI DELL'UTENTE");
        expect(ctx.systemPrompt).toContain('- Vive a Gallarate');
        expect(ctx.systemPrompt).not.toMatch(/save_memory|caring friend|CONVERSATION RULES|\(about you\)/);
        expect(ctx.systemPrompt).toMatch(/Oggi è \w+ \d+ \w+ \d{4}, (notte|mattina|pomeriggio|sera)\.$/);
        expect(ctx.systemPrompt.length).toBeLessThan(1200);
        const [turn] = historyWithTurnContext([msg('Che tempo fa domani?')], ctx);
        expect(turn.text).toMatch(/^<context>\nUsa questo contesto/);
        expect(turn.text).toContain("DA CONVERSAZIONI PASSATE (possono essere superate):\n- [2026-09-20, l'utente ha detto] Il mio cane si chiama Pepe");
    });

    it('follows the language setting and closes with the language rule', async () => {
        const ctx = await buildPromptContext({ personality: atlas, llmConfig: { ...config, assistantLanguage: 'en' }, history: [msg('Ciao!')], onDevice: true });
        expect(ctx.systemPrompt).toContain('WHAT YOU KNOW ABOUT THE USER');
        expect(withLanguageRule(ctx.systemPrompt, 'en')).toMatch(/Always write in English\.$/);
        expect(buildOnDeviceSystemPrompt(atlas, undefined, 'it', { now: new Date(2026, 9, 4, 21) })).toMatch(/domenica 4 ottobre 2026, sera\.$/);
    });

    it('a recall question gets the instruction in the user language', async () => {
        const ctx = await buildPromptContext({ personality: atlas, llmConfig: config, history: [msg('Ricordi dove abito?')], onDevice: true });
        expect(ctx.turnContext).toMatch(/L'UTENTE TI CHIEDE COSA RICORDI DI LUI/);
    });

    it('remote providers keep the companion prompt', async () => {
        const ctx = await buildPromptContext({ personality: atlas, llmConfig: { ...config, provider: 'gemini' }, history: [msg('Ciao')] });
        expect(ctx.systemPrompt).toContain('CONVERSATION RULES');
        expect(ctx.systemPrompt).not.toContain('save_memory');
    });
});
