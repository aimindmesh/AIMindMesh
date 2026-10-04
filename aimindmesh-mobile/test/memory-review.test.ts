import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));

import { markFactsForReview, reviewReason } from '../src/services/memory/facts/factReview';
import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';

beforeEach(async () => {
    localStorage.clear();
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
});

describe('one-time review of old facts', () => {
    it('takes the old junk out of the prompt, once, without deleting it', async () => {
        await factStore.add({ content: "L'utente ha chiesto un'informazione sui gatti.", source: 'extracted' });
        await factStore.add({ content: 'Domani corre 8 km al parco', source: 'inline' });
        await factStore.add({ content: 'Vive a Varese con la moglie Giulia', kind: 'identity', source: 'extracted' });
        await factStore.add({ content: 'Domani chiamo il medico', source: 'manual' }); // typed by the user
        expect(await markFactsForReview()).toBe(2);
        expect(factStore.active().map(f => f.content).sort()).toEqual(['Domani chiamo il medico', 'Vive a Varese con la moglie Giulia']);
        expect(factStore.list().filter(f => f.status === 'review')).toHaveLength(2);
        await factStore.add({ content: "L'utente ha chiesto del meteo.", source: 'extracted' });
        expect(await markFactsForReview()).toBe(0); // done once
    });

    it('explains why', () => {
        const fact = { status: 'active', source: 'extracted', content: 'I need to remember this fact.*', kind: 'other', importance: 3 } as any;
        expect(reviewReason(fact)).toBe('meta');
        expect(reviewReason({ ...fact, pinned: true })).toBeNull();
    });
});
