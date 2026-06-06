import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { isDesktop } from '../../utils/platform';
import { logger } from '../logger';

const SETTINGS_FILE = 'app-settings.json';

/**
 * Service to handle persistent settings on Desktop.
 * It mirrors localStorage keys to a JSON file.
 */
export const PersistenceService = {
    /**
     * Load settings from disk and populate localStorage.
     * Should be called before App startup.
     */
    hydrate: async () => {
        if (!isDesktop()) return;

        try {
            const exists = await isSettingsFileExists();
            if (!exists) {
                logger.log('info', 'Persistence: No settings file found, skipping hydration.');
                return;
            }

            const result = await Filesystem.readFile({
                path: SETTINGS_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            const settings = JSON.parse(result.data as string);

            // Populate localStorage
            Object.keys(settings).forEach(key => {
                // specific check to avoid overwriting session data if needed, 
                // but generally we want to restore everything saved.
                localStorage.setItem(key, JSON.stringify(settings[key]));
            });

            logger.log('info', `Persistence: Hydrated ${Object.keys(settings).length} keys from disk.`);
        } catch (error) {
            logger.log('error', 'Persistence: Failed to hydrate settings', error);
        }
    },

    /**
     * Save a specific key-value pair to disk.
     * This reads the current file, updates the key, and writes back.
     * Note: This is not atomic and could be slow for frequent updates.
     * Ideally, we should debounce this or keep an in-memory copy.
     */
    saveItem: async (key: string, value: any) => {
        if (!isDesktop()) return;

        try {
            // Optimization: Keep a cached version in memory? 
            // For now, read-modify-write for safety.
            let settings: Record<string, any> = {};

            try {
                const exists = await isSettingsFileExists();
                if (exists) {
                    const result = await Filesystem.readFile({
                        path: SETTINGS_FILE,
                        directory: Directory.Data,
                        encoding: Encoding.UTF8
                    });
                    settings = JSON.parse(result.data as string);
                }
            } catch (readError) {
                // ignore, start fresh
            }

            settings[key] = value;

            await Filesystem.writeFile({
                path: SETTINGS_FILE,
                data: JSON.stringify(settings, null, 2),
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
        } catch (error) {
            console.error('Persistence: Failed to save item', key, error);
        }
    },

    /**
     * Remove item from disk.
     */
    removeItem: async (key: string) => {
        if (!isDesktop()) return;
        try {
            const exists = await isSettingsFileExists();
            if (!exists) return;

            const result = await Filesystem.readFile({
                path: SETTINGS_FILE,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            const settings = JSON.parse(result.data as string);

            delete settings[key];

            await Filesystem.writeFile({
                path: SETTINGS_FILE,
                data: JSON.stringify(settings, null, 2),
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
        } catch (error) {
            console.error('Persistence: Failed to remove item', key, error);
        }
    }
};

async function isSettingsFileExists() {
    try {
        await Filesystem.stat({
            path: SETTINGS_FILE,
            directory: Directory.Data
        });
        return true;
    } catch {
        return false;
    }
}
