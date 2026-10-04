import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));

import { runAgent, type AgentDeps, type AgentRunState } from '../src/services/agent/agentRunner';
import { callSignature, maxToolSteps } from '../src/services/agent/loopControl';
import type { LLMConfig, Message } from '../src/types';
import type { StreamChunk } from '../src/services/llm/llmService';
import { routedTools as routedToolsOf } from '../src/services/llm/background/taskFlags';

const user = (text: string): Message => ({ id: 'u', role: 'user', text, timestamp: new Date() });
const config = { provider: 'genie-npu', enableToolCalling: true } as LLMConfig;
const last = <T,>(items: T[]): T | undefined => items[items.length - 1];
type Step = { text?: string; thinking?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> };

function fakeDeps(steps: Step[], overrides: Partial<AgentDeps> = {}) {
    const generated: Array<{ history: Message[]; tools: boolean }> = [];
    const ran: string[] = [];
    const deps: AgentDeps = {
        async *generate(history, cfg) {
            generated.push({ history, tools: !!cfg.enableToolCalling });
            const step = steps.shift() ?? { text: 'fine' };
            if (step.thinking) yield { type: 'thinking', content: step.thinking } as StreamChunk;
            if (step.text) yield { type: 'text', content: step.text } as StreamChunk;
            for (const call of step.calls ?? []) yield { type: 'function_call', call } as StreamChunk;
        },
        async runTool(call) { ran.push(call.name); return { name: call.name, success: true, result: `risultato di ${call.name}` }; },
        isDenied: () => false,
        needsConfirmation: () => false,
        ...overrides,
    };
    return { deps, generated, ran };
}

const run = (history: Message[], deps: AgentDeps, extra: Partial<Parameters<typeof runAgent>[0]> = {}) =>
    runAgent({ history, config, onDevice: true, language: 'it', ...extra }, deps, new AbortController().signal);

describe('agent runner', () => {
    it('answers directly when no tool is asked', async () => {
        const { deps, ran } = fakeDeps([{ text: 'Answer: Ciao! Tutto bene.' }]);
        const out = await run([user('Ciao!')], deps);
        expect(out).toMatchObject({ status: 'done', text: 'Ciao! Tutto bene.' });
        expect(ran).toEqual([]);
    });

    it('runs a tool and feeds the result back before the answer', async () => {
        const { deps, ran, generated } = fakeDeps([{ calls: [{ name: 'search_web', args: { query: 'meteo Varese' } }] }, { text: 'Domani sole a Varese.' }]);
        const out = await run([user('Che tempo fa domani a Varese?')], deps);
        expect(out).toMatchObject({ status: 'done', text: 'Domani sole a Varese.' });
        expect(ran).toEqual(['search_web']);
        expect(last(generated[1].history)?.text).toMatch(/^Observation:\n\[search_web\]: risultato di search_web/);
    });

    it('pauses on a call that needs confirmation and resumes with the decision', async () => {
        const { deps, ran } = fakeDeps([{ calls: [{ name: 'run_termux_command', args: { command: 'ls' } }] }, { text: 'Fatto.' }], { needsConfirmation: c => c.name === 'run_termux_command' });
        const paused = await run([user('Elenca i file')], deps);
        expect(paused.status).toBe('paused');
        const state = (paused as { state: AgentRunState }).state;
        const done = await runAgent({ history: [], config, onDevice: true, language: 'it', resume: { state, decision: { allowed: true } } }, deps, new AbortController().signal);
        expect(done).toMatchObject({ status: 'done', text: 'Fatto.' });
        expect(ran).toEqual(['run_termux_command']);
    });

    it('does not run the same call twice and forces the answer', async () => {
        const call = { name: 'search_web', args: { query: 'meteo' } };
        const { deps, ran, generated } = fakeDeps([{ calls: [call] }, { calls: [{ name: 'search_web', args: { query: ' Meteo ' } }] }, { text: 'Ecco il meteo.' }]);
        const out = await run([user('Meteo?')], deps);
        expect(out).toMatchObject({ status: 'done', text: 'Ecco il meteo.' });
        expect(ran).toEqual(['search_web']);
        expect(last(generated)?.tools).toBe(false);
        expect(last(last(generated)?.history ?? [])?.text).toMatch(/rispondi all'utente/);
    });

    it('stops after 3 tool steps on-device with a final turn without tools', async () => {
        const steps: Step[] = [1, 2, 3].map(i => ({ calls: [{ name: 'search_web', args: { query: `q${i}` } }] }));
        const { deps, ran, generated } = fakeDeps([...steps, { text: 'Risposta finale.' }]);
        const out = await run([user('Cerca tre cose')], deps);
        expect(ran).toHaveLength(3);
        expect(out).toMatchObject({ status: 'done', text: 'Risposta finale.' });
        expect(generated.map(g => g.tools)).toEqual([true, true, true, false]);
        expect(maxToolSteps(false, 5)).toBe(5);
    });

    it('a recall question gets no tools, and a web call would search the memory', async () => {
        const { deps, generated } = fakeDeps([{ text: "Non me l'hai ancora detto." }]);
        const out = await run([user('Ricordi dove abito?')], deps);
        expect(out).toMatchObject({ status: 'done', text: "Non me l'hai ancora detto." });
        expect(generated[0].tools).toBe(false);
        expect(callSignature({ name: 'a', args: { b: ' X ', a: 1 } })).toBe(callSignature({ name: 'a', args: { a: 1, b: 'x' } }));
    });

    it('nudges a model that only thought briefly, in the chosen language', async () => {
        const { deps, generated } = fakeDeps([{ thinking: 'Devo pensarci un attimo' }, { text: 'Ecco.' }]);
        const out = await run([user('Aiutami')], deps);
        expect(out).toMatchObject({ status: 'done', text: 'Ecco.' });
        expect(last(generated[1].history)?.text).toMatch(/^Continua/);
    });

    it('offers no tools for small talk, only the routed ones otherwise', async () => {
        const chat = fakeDeps([{ text: 'Ciao!' }]);
        await run([user('Ciao, come stai?')], chat.deps);
        expect(chat.generated[0].tools).toBe(false);
        const weather = fakeDeps([{ text: 'Sole.' }], {
            async *generate(_h, cfg) { yield { type: 'text', content: JSON.stringify(routedToolsOf(cfg)) } as StreamChunk; },
        });
        const out = await run([user('Che tempo fa a Lecco?')], weather.deps);
        expect(out).toMatchObject({ text: '["search_web","read_web_page"]' });
    });

    it('sends wrong arguments back once, then answers without tools', async () => {
        const bad = { name: 'create_calendar_event', args: { title: 'Dentista', date: 'boh', time: '15' } };
        const { deps, ran, generated } = fakeDeps([{ calls: [bad] }, { calls: [{ ...bad, args: { ...bad.args, time: 'presto' } }] }, { text: 'Non riesco a segnarlo.' }]);
        const out = await run([user("Segna in agenda il dentista boh alle 15")], deps);
        expect(ran).toEqual([]);
        expect(generated[1].history.some(m => /date must be a date YYYY-MM-DD/.test(m.text))).toBe(true);
        expect(generated[2].tools).toBe(false); // second failure: the answer, without tools
        expect(out).toMatchObject({ status: 'done', text: 'Non riesco a segnarlo.' });
    });

    it('asks once for a tool the reasoning planned but the answer skipped', async () => {
        const { deps, ran, generated } = fakeDeps([
            { thinking: 'I should use the `add_shopping_item` tool.', text: 'Ho aggiunto il latte.' },
            { calls: [{ name: 'add_shopping_item', args: { item: 'latte' } }] },
            { text: 'Latte aggiunto alla lista.' },
        ]);
        const out = await run([user('Aggiungi il latte alla lista della spesa')], deps);
        expect(last(generated[1].history)?.text).toMatch(/^Non hai ancora chiamato add_shopping_item/);
        expect(ran).toEqual(['add_shopping_item']);
        expect(out).toMatchObject({ status: 'done', text: 'Latte aggiunto alla lista.' });
    });

    it('answers without reasoning when the reasoning used the whole budget, never shows it as the answer', async () => {
        const long = 'Thinking Process: 1. Analyze the request. 2. Draft the response, checking the constraints carefully.';
        const { deps, generated } = fakeDeps([{ thinking: long }, { text: 'Si chiama Pepe.' }]);
        const configs: boolean[] = [];
        const wrapped = { ...deps, generate: (h: Message[], c: LLMConfig, s: AbortSignal) => { configs.push(!!c.enableThinking); return deps.generate(h, c, s); } };
        const out = await runAgent({ history: [user('Come si chiama il mio cane?')], config: { ...config, enableThinking: true }, onDevice: true, language: 'it' }, wrapped, new AbortController().signal);
        expect(configs).toEqual([true, false]);
        expect(out).toMatchObject({ status: 'done', text: 'Si chiama Pepe.' });
        expect(generated).toHaveLength(2);

        const silent = fakeDeps([{ thinking: long }, { thinking: long }]);
        expect(await run([user('Come si chiama il mio cane?')], silent.deps)).toMatchObject({ text: 'Non sono riuscito a formulare una risposta: puoi riformulare la domanda?' });
    });

    it('runs a call repeated in the same output once', async () => {
        const call = { name: 'add_shopping_item', args: { item: 'latte' } };
        const { deps, ran } = fakeDeps([{ calls: [call, { ...call }] }, { text: 'Fatto.' }]);
        await run([user('Aggiungi il latte alla lista della spesa')], deps);
        expect(ran).toEqual(['add_shopping_item']);
    });
});
