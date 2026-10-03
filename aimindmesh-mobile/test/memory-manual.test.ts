import { afterEach, describe, expect, it, vi } from 'vitest';
import { Memory } from '../src/types';
import {
    mergeImportedMemories, newMemoryId, normalizeCategory, uncategorizedMemories, updateCategory, withCategory,
} from '../src/services/memory/manualMemories';
import { decodeBase64Utf8 } from '../src/services/memory/memoryBackup';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: { pickFiles: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
    FileSystemAdapter: { writeFile: vi.fn() },
    Directory: { Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
}));

const memory = (id: string, content: string, category = 'other'): Memory => ({ id, content, category, timestamp: new Date(0) });

describe('manual memories', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('gives distinct ids to memories added in the same millisecond', () => {
        vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        const withCrypto = new Set(Array.from({ length: 200 }, newMemoryId));
        expect(withCrypto.size).toBe(200);

        vi.stubGlobal('crypto', undefined);
        const fallback = new Set(Array.from({ length: 200 }, newMemoryId));
        expect(fallback.size).toBe(200);
    });

    it('lists categories chosen by the model and shows unlisted ones apart', () => {
        expect(normalizeCategory('  general ')).toBe('general');
        expect(normalizeCategory('')).toBe('other');
        expect(withCategory(['personal'], 'general')).toEqual(['personal', 'general']);
        expect(withCategory(['personal'], 'personal')).toEqual(['personal']);

        const memories = [memory('1', 'a', 'personal'), memory('2', 'b', 'general')];
        expect(uncategorizedMemories(memories, ['personal']).map(m => m.id)).toEqual(['2']);
    });

    it('moves one memory when called with its id, renames a category otherwise', () => {
        const memories = [memory('1', 'a', 'work'), memory('2', 'b', 'work')];
        const moved = updateCategory(memories, ['work'], '1', 'personal');
        expect(moved.memories.map(m => m.category)).toEqual(['personal', 'work']);
        expect(moved.categories).toEqual(['work', 'personal']);

        const renamed = updateCategory(memories, ['work', 'tasks'], 'work', 'job');
        expect(renamed.memories.map(m => m.category)).toEqual(['job', 'job']);
        expect(renamed.categories).toEqual(['job', 'tasks']);
    });

    it('merges a backup without duplicates and re-ids colliding ids', () => {
        const existing = [memory('1', 'likes coffee'), memory('2', 'lives in Rome')];
        const merged = mergeImportedMemories(existing, [
            memory('1', 'likes coffee'),        // same memory
            memory('2', 'works as a nurse'),    // id taken by another memory
            memory('9', 'has a cat'),
        ]);
        expect(merged.map(m => m.content)).toEqual(['likes coffee', 'lives in Rome', 'works as a nurse', 'has a cat']);
        expect(new Set(merged.map(m => m.id)).size).toBe(4);
        expect(merged[3].id).toBe('9');
    });

    it('decodes backups with accented characters (UTF-8, not Latin-1)', () => {
        const json = JSON.stringify({ text: 'perché città' });
        const base64 = Buffer.from(json, 'utf-8').toString('base64');
        expect(JSON.parse(decodeBase64Utf8(base64)).text).toBe('perché città');
    });
});
