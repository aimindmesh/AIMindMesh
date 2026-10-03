import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Memory } from '../../types';
import { logger } from '../logger';

interface MemoryBackup {
    version: 1;
    exportDate: string;
    memories: Memory[];
    categories: string[];
}

/**
 * Export memories and categories to a JSON file in Documents. Returns the file name.
 */
export const exportMemoriesToFile = async (
    memories: Memory[],
    categories: string[]
): Promise<string> => {
    try {
        const backup: MemoryBackup = {
            version: 1,
            exportDate: new Date().toISOString(),
            memories,
            categories
        };

        const data = JSON.stringify(backup, null, 2);
        const filename = `memories-backup-${Date.now()}.json`;

        // Without an encoding the plugin expects base64 data and rejects plain JSON
        await Filesystem.writeFile({
            path: filename,
            data,
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

/**
 * Import memories from a JSON backup file
 */
export const importMemoriesFromFile = async (): Promise<{
    memories: Memory[];
    categories: string[];
} | null> => {
    try {
        const result = await FilePicker.pickFiles({
            types: ['application/json'],
            readData: true
        });

        if (result.files.length === 0) {
            return null;
        }

        const file = result.files[0];
        if (!file.data) {
            throw new Error('No file data received');
        }

        const backup: MemoryBackup = JSON.parse(decodeBase64Utf8(file.data));

        // Validate backup structure
        if (!backup.version || !Array.isArray(backup.memories) || !Array.isArray(backup.categories)) {
            throw new Error('Invalid backup file format');
        }

        // Restore memories with Date objects
        const restoredMemories = backup.memories
            .filter(m => m && typeof m.content === 'string' && m.content.trim())
            .map(m => ({
                ...m,
                id: String(m.id ?? ''),
                timestamp: new Date(m.timestamp),
                category: m.category || 'other' // Ensure category exists
            }));

        logger.log('info', `Imported ${restoredMemories.length} memories and ${backup.categories.length} categories`);

        return {
            memories: restoredMemories,
            categories: backup.categories.filter(c => typeof c === 'string' && c.trim())
        };
    } catch (error) {
        logger.log('error', 'Failed to import memories', error);
        throw new Error('Failed to import backup: ' + (error as any).message);
    }
};
