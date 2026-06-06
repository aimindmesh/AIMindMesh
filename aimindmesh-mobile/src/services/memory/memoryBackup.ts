import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
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
 * Export memories and categories to a JSON file
 */
export const exportMemoriesToFile = async (
    memories: Memory[],
    categories: string[]
): Promise<void> => {
    try {
        const backup: MemoryBackup = {
            version: 1,
            exportDate: new Date().toISOString(),
            memories,
            categories
        };

        const data = JSON.stringify(backup, null, 2);
        const filename = `memories-backup-${Date.now()}.json`;

        await Filesystem.writeFile({
            path: filename,
            data,
            directory: Directory.Documents
        });

        logger.log('info', `Memories exported: ${filename}`);
        alert(`✅ Backup saved successfully!\n\nFile: ${filename}\nLocation: Documents folder`);
    } catch (error) {
        logger.log('error', 'Failed to export memories', error);
        throw new Error('Failed to export memories: ' + (error as any).message);
    }
};

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

        // Decode base64 data
        const jsonString = atob(file.data);
        const backup: MemoryBackup = JSON.parse(jsonString);

        // Validate backup structure
        if (!backup.version || !backup.memories || !backup.categories) {
            throw new Error('Invalid backup file format');
        }

        // Restore memories with Date objects
        const restoredMemories = backup.memories.map(m => ({
            ...m,
            timestamp: new Date(m.timestamp),
            category: m.category || 'other' // Ensure category exists
        }));

        logger.log('info', `Imported ${restoredMemories.length} memories and ${backup.categories.length} categories`);

        return {
            memories: restoredMemories,
            categories: backup.categories
        };
    } catch (error) {
        logger.log('error', 'Failed to import memories', error);
        throw new Error('Failed to import backup: ' + (error as any).message);
    }
};
