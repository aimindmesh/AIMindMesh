import { describe, expect, it } from 'vitest';
import { resolveWhen } from '../src/services/memory/facts/dateResolver';

// Thursday 1 October 2026, 10:00
const REF = new Date(2026, 9, 1, 10, 0).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('date words → day', () => {
    it.each([
        ['domani', day(2026, 10, 2)], ['domani alle 10.30', day(2026, 10, 2)], ['domattina', day(2026, 10, 2)],
        ['dopodomani', day(2026, 10, 3)], ['stasera', day(2026, 10, 1)], ['oggi pomeriggio', day(2026, 10, 1)],
        ['sabato', day(2026, 10, 3)], ['sabato prossimo', day(2026, 10, 3)], ['venerdì', day(2026, 10, 2)],
        ['giovedì', day(2026, 10, 8)], ['questo giovedì', day(2026, 10, 1)], ['nel weekend', day(2026, 10, 3)],
        ['tra due settimane', day(2026, 10, 15)], ['fra 3 giorni', day(2026, 10, 4)], ['tra un mese', day(2026, 11, 1)],
        ['la settimana prossima', day(2026, 10, 5)], ['il mese prossimo', day(2026, 11, 1)],
        ['il 12 ottobre', day(2026, 10, 12)], ['12 settembre', day(2027, 9, 12)], ['il 3 marzo 2027', day(2027, 3, 3)],
        ['12/10', day(2026, 10, 12)], ['2026-12-24', day(2026, 12, 24)], ['a giugno', day(2027, 6, 1)],
        ['tomorrow', day(2026, 10, 2)], ['next Friday', day(2026, 10, 2)], ['October 12', day(2026, 10, 12)],
        ['in 2 weeks', day(2026, 10, 15)], ['tonight', day(2026, 10, 1)], ['ieri', day(2026, 9, 30)],
    ])('%s', (words, expected) => {
        expect(resolveWhen(words, REF)).toBe(expected);
    });

    it('names no date, a recurring one or an impossible one', () => {
        for (const words of ['', 'presto', 'ogni sabato', 'every Friday', 'tutti i lunedì', '31 febbraio', undefined]) {
            expect(resolveWhen(words as string, REF)).toBeUndefined();
        }
    });

    it('around the year end', () => {
        const newYearsEve = new Date(2026, 11, 31, 22, 0).getTime();
        expect(resolveWhen('domani', newYearsEve)).toBe(day(2027, 1, 1));
        expect(resolveWhen('il 6 gennaio', newYearsEve)).toBe(day(2027, 1, 6));
    });
});
