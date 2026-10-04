import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { logger } from '../logger';
import { Fact, isFactKind, clampImportance, MAX_FACT_LENGTH } from './facts/factTypes';
import { manualMemoryToFact } from './facts/factMigration';

/** v2: facts. v1 (older versions): the manual memory list, still accepted on import. */
interface MemoryBackupV2 {
    version: 2;
    exportDate: string;
    facts: Fact[];
    categories: string[];
}

export interface RestoredBackup {
    facts: Fact[];
    categories: string[];
}

/**
 * Export facts and categories to a JSON file in Documents. Returns the file name.
 */
export const exportMemoriesToFile = async (facts: Fact[], categories: string[]): Promise<string> => {
    try {
        const backup: MemoryBackupV2 = { version: 2, exportDate: new Date().toISOString(), facts, categories };
        const filename = `memories-backup-${Date.now()}.json`;

        // Without an encoding the plugin expects base64 data and rejects plain JSON
        await Filesystem.writeFile({
            path: filename,
            data: JSON.stringify(backup, null, 2),
            directory: Directory.Documents,
            encoding: Encoding.UTF8
        });

        logger.log('info', `Memories exported: ${filename}`);
        return filename;
    } catch (error) {
        logger.log('error', 'Failed to export memories', error);
        throw new Error('Failed to export memories: ' + (error as any).message);
    }
};

/** base64 of UTF-8 bytes -> text (atob alone would garble accented characters) */
export function decodeBase64Utf8(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

/** A fact read from a file: only known values are kept */
function sanitizeFact(raw: any, now: number): Fact | null {
    if (!raw || typeof raw.content !== 'string' || !raw.content.trim() || typeof raw.id !== 'string') return null;
    const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
        id: raw.id,
        kind: isFactKind(raw.kind) ? raw.kind : 'other',
        subject: typeof raw.subject === 'string' ? raw.subject : undefined,
        content: raw.content.trim().slice(0, MAX_FACT_LENGTH),
        category: typeof raw.category === 'string' ? raw.category : undefined,
        importance: clampImportance(raw.importance),
        confidence: typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.8,
        source: 'imported',
        sourceThread: typeof raw.sourceThread === 'string' ? raw.sourceThread : undefined,
        createdAt: time(raw.createdAt) ?? now,
        updatedAt: time(raw.updatedAt) ?? now,
        dueAt: time(raw.dueAt),
        status: ['active', 'done', 'superseded', 'expired', 'review'].includes(raw.status) ? raw.status : 'active',
        supersededBy: typeof raw.supersededBy === 'string' ? raw.supersededBy : undefined,
        pinned: raw.pinned === true,
        useCount: 0,
    };
}

/** Contents of a backup file, v1 or v2 (throws when it is not a backup) */
export function parseMemoryBackup(text: string, now: number = Date.now()): RestoredBackup {
    const backup = JSON.parse(text);
    const categories = Array.isArray(backup?.categories)
        ? backup.categories.filter((c: unknown) => typeof c === 'string' && c.trim())
        : [];
    if (backup?.version === 2 && Array.isArray(backup.facts)) {
        return { facts: backup.facts.map((f: unknown) => sanitizeFact(f, now)).filter(Boolean) as Fact[], categories };
    }
    if (backup?.version === 1 && Array.isArray(backup.memories)) {
        const facts = backup.memories
            .map((m: any) => manualMemoryToFact(m, now))
            .filter(Boolean)
            .map((f: Fact) => ({ ...f, id: `i:${f.id.slice(2)}`, source: 'imported' as const }));
        return { facts, categories };
    }
    throw new Error('Invalid backup file format');
}

/**
 * Import facts from a JSON backup file
 */
export const importMemoriesFromFile = async (): Promise<RestoredBackup | null> => {
    try {
        const result = await FilePicker.pickFiles({ types: ['application/json'], readData: true });
        if (result.files.length === 0) return null;

        const file = result.files[0];
        if (!file.data) throw new Error('No file data received');

        const restored = parseMemoryBackup(decodeBase64Utf8(file.data));
        logger.log('info', `Imported ${restored.facts.length} facts and ${restored.categories.length} categories`);
        return restored;
    } catch (error) {
        logger.log('error', 'Failed to import memories', error);
        throw new Error('Failed to import backup: ' + (error as any).message);
    }
};
