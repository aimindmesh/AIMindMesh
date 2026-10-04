import { afterEach, describe, expect, it, vi } from 'vitest';
import { newMemoryId, normalizeCategory, withCategory } from '../src/services/memory/manualMemories';
import { decodeBase64Utf8 } from '../src/services/memory/memoryBackup';

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: { pickFiles: vi.fn() } }));
vi.mock('../src/utils/fileSystemAdapter', () => ({
    FileSystemAdapter: { writeFile: vi.fn() },
    Directory: { Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
}));

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
    });

    it('decodes backups with accented characters (UTF-8, not Latin-1)', () => {
        const json = JSON.stringify({ text: 'perché città' });
        const base64 = Buffer.from(json, 'utf-8').toString('base64');
        expect(JSON.parse(decodeBase64Utf8(base64)).text).toBe('perché città');
    });
});
