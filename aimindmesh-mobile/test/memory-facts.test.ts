import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: { pickFiles: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({ FileSystemAdapter: { writeFile: vi.fn() }, Directory: { Documents: 'D' }, Encoding: { UTF8: 'utf8' } }));

import { factStore } from '../src/services/memory/facts/factStore';
import { LocalFactRepository } from '../src/services/memory/facts/factRepository';
import { MIGRATION_KEY } from '../src/services/memory/facts/factMigration';
import { buildProfile, rankRelevantFacts, stems } from '../src/services/memory/context/memoryContext';
import { parseMemoryBackup } from '../src/services/memory/memoryBackup';
import { executeForgetMemory, executeSaveMemory, executeSearchMemory, executeUpdateMemory } from '../src/services/tools/memoryTools';
import { Fact } from '../src/services/memory/facts/factTypes';

const DAY = 24 * 60 * 60 * 1000;

async function freshStore() {
    factStore.resetForTests();
    await factStore.init(new LocalFactRepository());
}

const fact = (over: Partial<Fact>): Fact => ({
    id: over.id ?? `f-${Math.random()}`, kind: 'other', content: 'x', importance: 3, confidence: 1, source: 'manual',
    createdAt: 1, updatedAt: 1, status: 'active', pinned: false, useCount: 0, ...over,
});

describe('facts store', () => {
    beforeEach(freshStore);

    it('reinforces a fact said again instead of storing it twice', async () => {
        const first = await factStore.add({ content: 'Works as a nurse', kind: 'identity', importance: 3 });
        const again = await factStore.add({ content: 'works as a nurse.', kind: 'identity', importance: 5 });
        expect(again).toMatchObject({ duplicate: true, fact: { id: first!.fact.id, importance: 5 } });
        expect(factStore.active()).toHaveLength(1);
    });

    it('keeps the old version when a fact changes, and announces every change', async () => {
        const changes: string[] = [];
        factStore.onChange(c => changes.push(c.type));
        const job = (await factStore.add({ content: 'Works at Acme', kind: 'identity', pinned: true }))!.fact;
        const newJob = await factStore.supersede(job.id, { content: 'Works at Globex' });

        expect(factStore.active().map(f => f.content)).toEqual(['Works at Globex']);
        expect(newJob).toMatchObject({ kind: 'identity', pinned: true });
        expect(factStore.get(job.id)).toMatchObject({ status: 'superseded', supersededBy: newJob!.id, pinned: false });
        await factStore.remove([job.id]);
        expect(changes).toEqual(['upsert', 'upsert', 'upsert', 'remove']);
    });

    it('moves the old manual memories into pinned facts once', async () => {
        factStore.resetForTests();
        localStorage.clear(); // a first install of this version: no facts, no migration marker
        localStorage.setItem('companion-memories', JSON.stringify([
            { id: '1', content: 'Wife is Giulia', category: 'personal', timestamp: '2026-01-01T10:00:00Z' },
            { id: '2', content: 'Loves bitter coffee', category: 'preferences', timestamp: '2026-01-02T10:00:00Z' },
        ]));
        const repo = new LocalFactRepository();
        await factStore.init(repo);
        expect(factStore.active().map(f => [f.id, f.kind, f.pinned])).toEqual([['m:1', 'identity', true], ['m:2', 'preference', true]]);
        expect(await repo.getMeta(MIGRATION_KEY)).not.toBeNull();
        expect(localStorage.getItem('companion-memories')).not.toBeNull(); // nothing deleted

        // A second start does not migrate again (an edit survives)
        await factStore.update('m:1', { content: 'Wife is Giulia, a teacher' });
        factStore.resetForTests();
        await factStore.init(repo);
        expect(factStore.get('m:1')?.content).toBe('Wife is Giulia, a teacher');
    });
});

describe('profile and relevance', () => {
    const now = new Date(2026, 9, 3, 12).getTime();

    it('is ordered by pin and importance (never by use) and fits its budget', () => {
        const facts = [
            fact({ id: 'a', content: 'Likes jazz', kind: 'preference', importance: 2, useCount: 99, lastUsedAt: now }),
            fact({ id: 'b', content: 'Is called Andrea', kind: 'identity', importance: 5 }),
            fact({ id: 'c', content: 'Allergic to nuts', kind: 'other', importance: 2, pinned: true }),
            fact({ id: 'd', content: 'Job interview at Acme', kind: 'event', dueAt: now + 3 * DAY }),
            fact({ id: 'e', content: 'Old trip', kind: 'event', dueAt: now - 30 * DAY }),
            fact({ id: 'f', content: 'Replaced', status: 'superseded', importance: 5 }),
        ];
        const profile = buildProfile(facts, 2000, now);
        expect(profile.factIds).toEqual(['d', 'c', 'b', 'a']);
        expect(profile.text).toMatch(/WHAT YOU KNOW[\s\S]*Allergic to nuts[\s\S]*Is called Andrea[\s\S]*Likes jazz/);
        expect(profile.text).toContain('COMING UP FOR THE USER (ask how it went afterwards):\n- 2026-10-06: Job interview at Acme');
        expect(buildProfile(facts, 60, now).factIds.length).toBeLessThan(4);
    });

    it('matches Italian word forms and skips stopwords', () => {
        expect([...stems('Dove lavoro adesso?')]).toEqual(['lavor', 'adess']);
        const facts = [fact({ id: 'job', content: 'Lavora come infermiera a Torino' }), fact({ id: 'cat', content: 'Ha un gatto' })];
        expect(rankRelevantFacts('Com\'è andato il lavoro oggi?', facts, new Set(), { limit: 3 }).map(f => f.id)).toEqual(['job']);
        expect(rankRelevantFacts('lavoro', facts, new Set(['job']), { limit: 3 })).toEqual([]);
    });
});

describe('backups', () => {
    it('restores the current format and the old manual list', () => {
        const v2 = parseMemoryBackup(JSON.stringify({ version: 2, facts: [fact({ id: 'z', content: 'Has a cat', kind: 'other', source: 'extracted' })], categories: ['home'] }));
        expect(v2).toMatchObject({ facts: [{ id: 'z', content: 'Has a cat', source: 'imported' }], categories: ['home'] });
        const v1 = parseMemoryBackup(JSON.stringify({ version: 1, memories: [{ id: '7', content: 'Lives in Rome', category: 'personal', timestamp: 5 }], categories: [] }));
        expect(v1.facts[0]).toMatchObject({ id: 'i:7', kind: 'identity', pinned: true, source: 'imported' });
        expect(() => parseMemoryBackup('{"version":9}')).toThrow();
    });
});

describe('memory tools', () => {
    beforeEach(freshStore);

    it('lets the assistant save, find, correct and forget a fact', async () => {
        await executeSaveMemory({ content: 'Sister Anna lives in Milan', kind: 'person', about: 'Anna' });
        const found = await executeSearchMemory({ query: 'Where does Anna live?' });
        const id = found.data.ids[0];
        expect(found.message).toContain(`[${id}] (people) Anna: Sister Anna lives in Milan`);

        expect((await executeUpdateMemory({ memory_id: id, content: 'Sister Anna moved to Turin' })).success).toBe(true);
        const newId = factStore.active()[0].id;
        expect(factStore.active().map(f => f.content)).toEqual(['Sister Anna moved to Turin']);
        expect((await executeForgetMemory({ memory_id: newId })).success).toBe(true);
        expect(factStore.active()).toEqual([]);
        expect((await executeForgetMemory({ memory_id: 'nope' })).success).toBe(false);
    });
});
