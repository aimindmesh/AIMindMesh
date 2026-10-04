import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { gateFact, type UserLine } from '../src/services/memory/facts/factGate';
import { groundingMessage } from '../src/services/memory/facts/factGrounding';
import { resolveWhen } from '../src/services/memory/facts/dateResolver';
import { validateOps } from '../src/services/memory/facts/factConsolidator';
import { FACT_OPS_GRAMMAR, buildConsolidationPrompt, localDay } from '../src/services/memory/facts/consolidationPrompt';
import type { Fact } from '../src/services/memory/facts/factTypes';
import type { Message } from '../src/types';

// Thursday 1 October 2026, 18:00
const THU = new Date(2026, 9, 1, 18).getTime();
const day = (t: number | undefined) => t === undefined ? undefined : localDay(t);
const said = (...texts: string[]): UserLine[] => texts.map(text => ({ text, time: THU }));
const msg = (role: Message['role'], text: string): Message => ({ id: text.slice(0, 8), role, text, timestamp: new Date(THU) });

describe('fact gate', () => {
    it('takes the date from the words, relative to when they were said', () => {
        const bike = gateFact({ content: 'Giro in bici sul lago Maggiore con Marco', kind: 'event', when: 'sabato', evidence: 'Sabato vado a fare un giro in bici sul lago Maggiore con Marco' },
            { userMessages: said('Sabato vado a fare un giro in bici sul lago Maggiore con Marco'), now: THU + 3 * 86_400_000 });
        expect(bike.ok && [bike.fact.kind, day(bike.fact.dueAt)]).toEqual(['event', '2026-10-03']);
        // No "when": the evidence of a dated fact still gives the day
        const dentist = gateFact({ content: 'Ha il dentista', kind: 'event', evidence: 'Domani alle 10 ho il dentista' }, { userMessages: said('Domani alle 10 ho il dentista, che ansia'), now: THU });
        expect(dentist.ok && day(dentist.fact.dueAt)).toBe('2026-10-02');
        // Today's date copied from the prompt header is not what the user said
        const moved = gateFact({ content: 'Si è trasferito a Gallarate', kind: 'identity', when: '2026-10-01', evidence: 'Mi sono appena trasferito a Gallarate' },
            { userMessages: said('Mi sono appena trasferito a Gallarate'), now: THU });
        expect(moved.ok && [moved.fact.kind, moved.fact.dueAt]).toEqual(['identity', undefined]);
    });

    it('a person in a sentence with "tomorrow" is not an event; a habit has no date', () => {
        const pepe = gateFact({ content: 'Ha un beagle di nome Pepe', kind: 'person', evidence: 'Ho un beagle che si chiama Pepe e domani lo porto dal veterinario' },
            { userMessages: said('Ho un beagle che si chiama Pepe e domani lo porto dal veterinario'), now: THU });
        expect(pepe.ok && [pepe.fact.kind, pepe.fact.dueAt]).toEqual(['person', undefined]);
        const gym = gateFact({ content: 'Il martedì sera va in palestra con un amico', kind: 'event', when: 'ogni martedì' },
            { userMessages: said('Ogni martedì sera vado in palestra con un amico'), now: THU });
        expect(gym.ok && [gym.fact.kind, gym.fact.dueAt]).toEqual(['routine', undefined]);
    });

    it('refuses facts not said by the user, undated relative plans, past events and trivia', () => {
        const lines = said('Cosa posso cucinare stasera?');
        expect(gateFact({ content: 'Vuole cucinare pasta al pesto con pomodorini', kind: 'goal' }, { userMessages: lines, now: THU })).toMatchObject({ ok: false, reason: 'ungrounded' });
        expect(gateFact({ content: 'Il giorno odierno è giovedì 1 ottobre', kind: 'other' }, { userMessages: lines, now: THU })).toMatchObject({ ok: false, reason: 'ungrounded' });
        expect(gateFact({ content: 'Domani va a correre' }, { now: THU }).ok).toBe(true); // a tool call: said now
        expect(gateFact({ content: 'Prima o poi va a correre domani o dopo' , when: 'boh' }, { now: THU }).ok).toBe(true);
        expect(gateFact({ content: 'Ieri è andato dal dentista', kind: 'event' }, { now: THU })).toMatchObject({ ok: false, reason: 'past-event' });
        expect(gateFact({ content: 'Ha visto un film carino', importance: 1 }, { now: THU })).toMatchObject({ ok: false, reason: 'trivia' });
    });

    it('caps facts of no kind at importance 2 and spots near duplicates', () => {
        const other = gateFact({ content: 'Ha visto un documentario sulle balene', importance: 5 }, { now: THU });
        expect(other.ok && [other.fact.kind, other.fact.importance]).toEqual(['other', 2]);
        const known = [{ id: 'k', content: 'Vive a Varese con la moglie Giulia', kind: 'identity', status: 'active' } as Fact];
        expect(gateFact({ content: 'Vive a Varese con la moglie Giulia.', kind: 'identity' }, { now: THU, known })).toMatchObject({ ok: false, reason: 'duplicate' });
        expect(gateFact({ content: 'Vive a Busto Arsizio', kind: 'identity' }, { now: THU, known }).ok).toBe(true);
    });

    it('grounds paraphrases and quotes, never the assistant', () => {
        const texts = ["Mi sono appena trasferito a Gallarate per lavoro, faccio l'infermiere all'ospedale"];
        expect(groundingMessage(undefined, "Lavora come infermiere all'ospedale", texts)).toBe(0);
        expect(groundingMessage('trasferito a Gallarate per lavoro', 'Vive a Gallarate', texts)).toBe(0);
        expect(groundingMessage(undefined, 'Vive a Gallarate', texts)).toBe(0); // half of a short fact
        expect(groundingMessage(undefined, 'Vive a Busto Arsizio', texts)).toBe(-1);
    });
});

describe('consolidation with the gate', () => {
    it('splits, dates and grounds the operations against the batch', () => {
        const batch = [msg('user', 'Venerdì devo assolutamente chiamare la banca per il mutuo'), msg('model', 'Vuoi che te lo ricordi? Potresti anche fare yoga.')];
        const ops = validateOps([
            { op: 'add', kind: 'commitment', content: 'Deve chiamare la banca per il mutuo', when: 'venerdì', evidence: 'Venerdì devo assolutamente chiamare la banca per il mutuo', importance: 3 },
            { op: 'add', kind: 'goal', content: 'Vuole fare yoga', importance: 3 },
            { op: 'add', kind: 'commitment', content: 'Deve chiamare la banca per il mutuo', when: 'venerdì', importance: 3 },
        ], [], [], { batch, now: THU });
        expect(ops.map(o => [o.content, o.kind, day(o.dueAt)])).toEqual([['Deve chiamare la banca per il mutuo', 'commitment', '2026-10-02']]);
    });

    it('reads the kind a small model wrote in "op"', () => {
        const batch = [msg('user', 'Venerdì devo assolutamente chiamare la banca per il mutuo')];
        const ops = validateOps([{ op: 'commitment' as any, content: "L'utente deve chiamare la banca per il mutuo", when: 'venerdì', importance: 4 }], [], [], { batch, now: THU });
        expect(ops.map(o => [o.op, o.kind, day(o.dueAt)])).toEqual([['add', 'commitment', '2026-10-02']]);
    });

    it('marks a commitment done only when the user said so', () => {
        const known = [{ id: 'b', kind: 'commitment', content: 'Deve chiamare la banca', status: 'active', importance: 3 } as Fact];
        expect(validateOps([{ op: 'done', ref: 'F1' }], known, [], { batch: [msg('user', 'Che tempo fa domani?')], now: THU })).toHaveLength(0);
        expect(validateOps([{ op: 'done', ref: 'F1', evidence: 'ho chiamato la banca' }], known, [], { batch: [msg('user', 'Finalmente ho chiamato la banca!')], now: THU })).toHaveLength(1);
    });

    it('writes the prompt in the assistant language with the evidence/when schema', () => {
        const prompt = buildConsolidationPrompt({ batch: [msg('user', 'Ciao')], known: [], now: THU, maxChars: 500, lang: 'it' });
        expect(prompt).toMatch(/^Oggi è giovedì 2026-10-01\./);
        expect(prompt).toContain('"evidence":"<parole dell\'utente>"');
        expect(prompt).toContain('Un fatto per operazione');
        expect(FACT_OPS_GRAMMAR).toMatch(/^root ::= /);
    });
});

describe('date words', () => {
    it('an article before the weekday is a habit; a time is not a date', () => {
        expect(resolveWhen('il sabato', THU)).toBeUndefined();
        expect(day(resolveWhen('il sabato prossimo', THU))).toBe('2026-10-03');
        expect(day(resolveWhen('sabato', THU))).toBe('2026-10-03');
        expect(day(resolveWhen('domani alle 10.12', THU))).toBe('2026-10-02');
    });
});
