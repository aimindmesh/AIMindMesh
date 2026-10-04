import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/llm/background/backgroundLlm', () => ({ runBackgroundTask: mocks.run, ON_DEVICE_IDLE_MS: 180_000 }));

import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import {
    applyOps, batchMessages, buildConsolidationPrompt, expireOpenLoops, messagesAfterCursor, parseDueDate, parseOps, validateOps,
} from '../src/services/memory/facts/factConsolidator';
import { ConsolidationScheduler } from '../src/services/memory/facts/consolidationScheduler';
import { beginChatActivity, resetChatActivity } from '../src/services/llm/background/chatActivity';
import type { Message } from '../src/types';
import type { Fact } from '../src/services/memory/facts/factTypes';

const msg = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message =>
    ({ id, role, text, timestamp: new Date(2026, 9, 3, 10, 0), ...extra });

beforeEach(async () => {
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
    resetChatActivity();
    mocks.run.mockReset();
});

describe('reading the conversation', () => {
    it('skips hidden triggers, tool turns and errors, and resumes after the cursor', () => {
        const messages = [
            msg('1', 'user', 'Ciao'), msg('2', 'model', 'Ciao!'),
            msg('3', 'user', '(System: call answered)', { hidden: true }), msg('tool_4', 'user', 'Observation: ...'),
            msg('5', 'model', 'Sorry, I encountered an error: x'), msg('6', 'user', 'Domani ho il colloquio'),
        ];
        expect(messagesAfterCursor(messages, '2').map(m => m.id)).toEqual(['6']);
        expect(messagesAfterCursor(messages, null).map(m => m.id)).toEqual(['1', '2', '6']);
        expect(messagesAfterCursor(messages, 'gone', 1).map(m => m.id)).toEqual(['6']);
        expect(batchMessages([msg('a', 'user', 'x'.repeat(60)), msg('b', 'user', 'y'.repeat(60))], 100).map(b => b.length)).toEqual([1, 1]);
    });

    it('asks for operations with the known facts and absolute dates', () => {
        const known = [{ id: 'k', kind: 'event', content: 'Colloquio da Acme', dueAt: new Date(2026, 9, 4, 12).getTime() } as Fact];
        const prompt = buildConsolidationPrompt({
            batch: [msg('1', 'user', 'Il colloquio è andato bene!')], known, now: new Date(2026, 9, 5, 9).getTime(), maxChars: 1000, categories: ['lavoro'],
        });
        expect(prompt).toContain('Today is Monday 2026-10-05.');
        expect(prompt).toContain('F1 [event, 2026-10-04] Colloquio da Acme');
        expect(prompt).toContain('[2026-10-03 10:00] User: Il colloquio è andato bene!');
        expect(prompt).toContain('"category": one of "lavoro"');
    });
});

describe('model operations', () => {
    it('reads JSON with fences or text around it', () => {
        expect(parseOps('Sure:\n```json\n{"ops":[{"op":"add","content":"Has a cat"}]}\n```\nDone.')).toHaveLength(1);
        expect(parseOps('[{"op":"done","ref":"F1"}]')).toEqual([{ op: 'done', ref: 'F1' }]);
        expect(parseOps('no json here')).toEqual([]);
        expect(parseDueDate('2026-02-30')).toBeUndefined();
        expect(new Date(parseDueDate('2026-10-10')!).getDate()).toBe(10);
    });

    it('keeps only valid operations', () => {
        const known = [
            { id: 'job', kind: 'identity', content: 'Works at Acme', status: 'active', updatedAt: 1 } as Fact,
            { id: 'meet', kind: 'event', content: 'Interview', status: 'active', updatedAt: 1 } as Fact,
        ];
        const ops = validateOps([
            { op: 'add', kind: 'pet' as any, content: 'Has a cat', importance: 9, due: 'soon' },
            { op: 'add', content: 'ok' },                                   // too short
            { op: 'update', ref: 'F1', content: 'works at acme.' },         // nothing changed
            { op: 'update', ref: 'F1', content: 'Works at Globex' },
            { op: 'done', ref: 'F1' },                                      // not an open loop
            { op: 'done', ref: 'F2' },
            { op: 'update', ref: 'F9', content: 'Unknown ref' },
            { op: 'add', content: 'Likes tea', category: 'secret' },        // label not offered
        ], known, ['home']);
        expect(ops.map(o => [o.op, o.content, o.kind, o.importance, o.category])).toEqual([
            ['add', 'Has a cat', 'person', 5, undefined],     // kind by rules
            ['update', 'Works at Globex', 'identity', undefined, undefined],
            ['done', 'Interview', 'event', undefined, undefined],
            ['add', 'Likes tea', 'preference', 3, undefined],
        ]);
    });

    it('applies them, but never over a fact the user edited meanwhile', async () => {
        const job = (await factStore.add({ content: 'Works at Acme', kind: 'identity' }))!.fact;
        const ops = validateOps([{ op: 'update', ref: 'F1', content: 'Works at Globex' }, { op: 'add', kind: 'person', content: 'Sister is Anna' }], [job]);
        await factStore.update(job.id, { content: 'Works at Acme (manager)' });
        const result = await applyOps(ops, 't1');
        expect(result).toMatchObject({ added: 1, updated: 0, skipped: 1 });
        expect(factStore.active().map(f => f.content).sort()).toEqual(['Sister is Anna', 'Works at Acme (manager)']);
    });

    it('expires open loops two days past their date', async () => {
        const now = Date.now();
        await factStore.add({ content: 'Dentist appointment', kind: 'event', dueAt: now - 3 * 86_400_000 });
        await factStore.add({ content: 'Pay the rent', kind: 'commitment', dueAt: now + 86_400_000 });
        expect(await expireOpenLoops(now)).toBe(1);
        expect(factStore.list().map(f => f.status).sort()).toEqual(['active', 'expired']);
    });
});

describe('consolidation scheduler', () => {
    const conversation = [msg('1', 'user', 'Mi sono trasferito a Torino per lavoro'), msg('2', 'model', 'Che bello!')];

    it('reads a quiet conversation once and moves the cursor', async () => {
        const scheduler = new ConsolidationScheduler();
        mocks.run.mockResolvedValue({ text: '{"ops":[{"op":"add","kind":"identity","content":"Vive a Torino","importance":4}]}' });
        scheduler.note('t1', conversation);
        await scheduler.run('test');
        expect(factStore.active().map(f => [f.content, f.source, f.sourceThread])).toEqual([['Vive a Torino', 'extracted', 't1']]);
        expect(await factStore.getMeta('consolidation-cursor:t1')).toBe('2');

        scheduler.note('t1', conversation); // nothing new after the cursor
        await scheduler.run('again');
        expect(mocks.run).toHaveBeenCalledTimes(1);
        scheduler.reset();
    });

    it('waits while the user chats or the model is busy, without losing messages', async () => {
        const scheduler = new ConsolidationScheduler();
        scheduler.note('t2', conversation);
        const end = beginChatActivity();
        await scheduler.run('busy chat');
        expect(mocks.run).not.toHaveBeenCalled();
        end();

        mocks.run.mockResolvedValue({ text: null, skipped: 'chat_active' });
        await scheduler.run('model busy');
        expect(await factStore.getMeta('consolidation-cursor:t2')).toBeNull();
        expect(scheduler.hasPending()).toBe(true);
        scheduler.reset();
    });
});
