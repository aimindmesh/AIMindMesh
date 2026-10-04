import { beforeEach, describe, expect, it, vi } from 'vitest';

const genie = vi.hoisted(() => ({ getCapabilities: vi.fn() }));
vi.mock('genie-capacitor', () => ({ Genie: genie }));
vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { autoContextFor, contextLabel, detectDeviceContext, genieContextSize, onDeviceContextSize, setLoadedBundleContext } from '../src/services/llm/context/contextSize';
import { budgetFor } from '../src/services/llm/context/turnBudget';
import { cutMiddle, fitTurnText, refineContext } from '../src/services/llm/context/unifiedContextManager';
import { lengthHint } from '../src/services/llm/prompt/promptTexts';
import { cachedForTurn, holdTurnContext } from '../src/services/llm/context/turnContextCache';
import type { LLMConfig, Message, Personality } from '../src/types';

const cfg = (c: Partial<LLMConfig>) => ({ provider: 'native-gguf', ...c } as LLMConfig);
const atlas = { name: 'Atlas', llmParams: { maxTokens: 250 } } as Personality;
const plain = { name: 'Ada' } as Personality;

describe('auto context', () => {
    beforeEach(() => localStorage.clear());

    it('8192 on the 8 Elite, 4096 elsewhere; a value set by hand wins', async () => {
        expect(autoContextFor('v79')).toBe(8192);
        expect(autoContextFor('v81')).toBe(8192);
        expect(autoContextFor('v73')).toBe(4096);
        expect(autoContextFor(undefined)).toBe(4096);
        genie.getCapabilities.mockResolvedValue({ hasNpu: true, npuArch: 'v79', supportedRuntimes: [] });
        await detectDeviceContext();
        expect(onDeviceContextSize(cfg({ nCtx: 2048 }))).toBe(8192); // the old default is not a choice
        expect(onDeviceContextSize(cfg({ nCtx: 2048, contextMode: 'manual' }))).toBe(2048);
        expect(contextLabel(cfg({}))).toBe('Auto (8192)');
        expect(localStorage.getItem('aimm-npu-arch')).toBe('v79');
    });

    it('a QAIRT bundle keeps the context it was exported with', () => {
        setLoadedBundleContext(undefined);
        expect(genieContextSize(cfg({}), false)).toBe(4096);
        setLoadedBundleContext(2048);
        expect(onDeviceContextSize(cfg({ provider: 'genie-npu', nativeModelPath: '/models/llama3' }))).toBe(2048);
        expect(onDeviceContextSize(cfg({ provider: 'genie-npu', nativeModelPath: '/models/gemma.gguf' }))).toBe(8192);
        setLoadedBundleContext(undefined);
    });
});

describe('turn budget', () => {
    it('the persona limit is the answer; reasoning on top; never more than half the window', () => {
        expect(budgetFor(cfg({}), atlas, 1500, 8192)).toEqual({ context: 8192, answer: 250, requested: 250, maxTokens: 250 });
        expect(budgetFor(cfg({ enableThinking: true }), atlas, 1500, 8192)).toMatchObject({ requested: 762, maxTokens: 762 });
        expect(budgetFor(cfg({ enableThinking: true }), plain, 4000, 2048)).toMatchObject({ answer: 4000, maxTokens: 1024 });
    });

    it('a short answer limit becomes a short-answer rule in the assistant language', () => {
        expect(lengthHint('it', 250)).toMatch(/^Rispondi in breve/);
        expect(lengthHint('en', 512)).toMatch(/^Answer completely/);
        expect(lengthHint('it', 1500)).toBe('');
    });
});

describe('context trimming', () => {
    it('cuts the middle of a long system prompt, keeping persona and closing rules', () => {
        const text = `PERSONA\n${'profilo '.repeat(200)}\nScrivi sempre e solo in italiano.`;
        const cut = cutMiddle(text, 300);
        expect(cut.length).toBeLessThanOrEqual(300);
        expect(cut.startsWith('PERSONA')).toBe(true);
        expect(cut.endsWith('Scrivi sempre e solo in italiano.')).toBe(true);
    });

    it('shrinks the memory context of the last turn before the request', () => {
        const turn = `<context>\nUsa questo contesto:\n${'- fatto '.repeat(300)}\n\nL'UTENTE TI CHIEDE COSA RICORDI DI LUI.\n</context>\n\nRicordi dove abito?`;
        const fitted = fitTurnText(turn, 400);
        expect(fitted.length).toBeLessThanOrEqual(400);
        expect(fitted.endsWith('Ricordi dove abito?')).toBe(true);
        expect(fitted).toContain("L'UTENTE TI CHIEDE COSA RICORDI DI LUI.");
        expect(fitted.startsWith('<context>\nUsa questo contesto:')).toBe(true);
    });

    it('refineContext keeps the language rule and the question on a small window', () => {
        const system = `Sei Atlas.\n${'Sa che '.repeat(900)}\nScrivi sempre e solo in italiano.`;
        const history: Message[] = [
            { id: '1', role: 'user', text: 'ciao '.repeat(400), timestamp: new Date() },
            { id: '2', role: 'model', text: 'ciao', timestamp: new Date() },
            { id: '3', role: 'user', text: `<context>\nContesto:\n${'- ricordo '.repeat(500)}\n</context>\n\nChe tempo fa domani?`, timestamp: new Date() },
        ];
        const out = refineContext(history, system, cfg({}), 250, 1024);
        expect(out.systemPrompt.endsWith('Scrivi sempre e solo in italiano.')).toBe(true);
        expect(out.messages.map(m => m.id)).toEqual(['3']);
        expect(out.messages[0].text.endsWith('Che tempo fa domani?')).toBe(true);
    });
});

describe('turn context cache', () => {
    it('computes once while a run holds it, every time otherwise', async () => {
        const build = vi.fn(async () => 'ctx');
        await cachedForTurn('k', build);
        await cachedForTurn('k', build);
        expect(build).toHaveBeenCalledTimes(2);
        const release = holdTurnContext();
        await cachedForTurn('k', build);
        await cachedForTurn('k', build);
        expect(build).toHaveBeenCalledTimes(3);
        release();
        release(); // twice is harmless
        await cachedForTurn('k', build);
        expect(build).toHaveBeenCalledTimes(4);
    });
});
