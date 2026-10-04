import { describe, expect, it } from 'vitest';
import { isGrounded } from '../src/services/memory/facts/factGrounding';
import { guessKind } from '../src/services/memory/facts/factKind';

const user = ['Mi sono appena trasferito a Gallarate per lavoro, faccio l\'infermiere all\'ospedale', 'Che tempo fa domani a Milano?'];

describe('grounding', () => {
    it('accepts facts quoted from the user', () => {
        expect(isGrounded('trasferito a Gallarate per lavoro', user, "Vive a Gallarate")).toBe(true);
        expect(isGrounded("faccio l'infermiere all'ospedale", user, "Lavora come infermiere in ospedale")).toBe(true);
    });

    it('rejects invented quotes, assistant lines and quotes unrelated to the fact', () => {
        expect(isGrounded('il giorno odierno è il 4 ottobre', user, 'Il giorno odierno è il 4 ottobre 2026')).toBe(false);
        expect(isGrounded('potresti preparare una pasta al pesto', user, 'Cucina pasta al pesto')).toBe(false);
        expect(isGrounded('Che tempo fa domani a Milano', user, 'Vive a Gallarate')).toBe(false);
        expect(isGrounded('', user, 'Vive a Gallarate')).toBe(false);
    });
});

describe('fact kind by rules', () => {
    it.each([
        ['Vive a Gallarate con la moglie Sara', undefined, 'identity'],
        ['Lavora come infermiere', undefined, 'identity'],
        ['La sorella si chiama Giulia', undefined, 'person'],
        ['Ha un beagle di nome Pepe', undefined, 'other'],
        ['Il suo cane è un beagle', undefined, 'person'],
        ['Non gli piace il caffè', undefined, 'preference'],
        ['Va in palestra ogni martedì', undefined, 'routine'],
        ['Vorrebbe correre la mezza maratona', undefined, 'goal'],
        ['Deve chiamare la banca per il mutuo', Date.now(), 'commitment'],
        ['Dentista alle 10', Date.now(), 'event'],
    ])('%s → %s', (content, due, kind) => {
        expect(guessKind(content, due as number | undefined)).toBe(kind);
    });
});
