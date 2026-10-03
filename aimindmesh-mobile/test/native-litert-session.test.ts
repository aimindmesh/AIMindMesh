import { describe, expect, it } from 'vitest';
import { canAppendToSession, snapshotOf } from '../src/services/llm/providers/liteRT/sessionTracking';

const msgs = (...ids: string[]) => ids.map(id => ({ id }));

describe('LiteRT native session tracking', () => {
    it('appends the next turn of the same thread', () => {
        const snap = snapshotOf(msgs('u1', 'a1', 'u2'));
        expect(canAppendToSession(snap, msgs('u1', 'a1', 'u2', 'a2', 'u3'), 2)).toBe(true);
    });

    it('refuses another thread with a compatible length', () => {
        const snap = snapshotOf(msgs('u1', 'a1', 'u2'));
        expect(canAppendToSession(snap, msgs('x1', 'y1', 'x2', 'y2', 'x3'), 2)).toBe(false);
        // Same first message (e.g. a shared greeting) but a different turn history
        expect(canAppendToSession(snap, msgs('u1', 'b1', 'v2', 'b2', 'v3'), 2)).toBe(false);
    });

    it('refuses regenerations and skipped turns', () => {
        const snap = snapshotOf(msgs('u1', 'a1', 'u2'));
        expect(canAppendToSession(snap, msgs('u1', 'a1', 'u2'), 2)).toBe(false);
        expect(canAppendToSession(snap, msgs('u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4'), 2)).toBe(false);
    });

    it('refuses when the native session is empty or unknown', () => {
        const snap = snapshotOf(msgs('u1'));
        expect(canAppendToSession(snap, msgs('u1', 'a1', 'u2'), 0)).toBe(false);
        expect(canAppendToSession(null, msgs('u1', 'a1', 'u2'), 4)).toBe(false);
        expect(snapshotOf([])).toBeNull();
    });
});
