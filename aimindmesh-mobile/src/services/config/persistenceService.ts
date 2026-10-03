import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { isDesktop } from '../../utils/platform';
import { logger } from '../logger';

const SETTINGS_FILE = 'app-settings.json';
/** Changes made within this delay are written together (a settings save changes ~25 keys) */
const WRITE_DELAY_MS = 250;

/**
 * In-memory copy of the file: every change goes into it and one writer saves it.
 * Separate read-modify-write cycles per key used to overwrite each other's changes.
 */
let cache: Record<string, any> | null = null;
let loading: Promise<Record<string, any>> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

async function readSettingsFile(): Promise<Record<string, any>> {
    if (!(await isSettingsFileExists())) return {};
    const result = await Filesystem.readFile({
        path: SETTINGS_FILE,
        directory: Directory.Data,
        encoding: Encoding.UTF8
    });
    return JSON.parse(result.data as string);
}

/** The cached settings, read from disk the first time */
function loadCache(): Promise<Record<string, any>> {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
        loading = readSettingsFile()
            .catch(() => ({})) // unreadable: start fresh
            .then(settings => {
                // Changes made while the file was being read win over its content
                cache = { ...settings, ...(cache ?? {}) };
                return cache;
            });
    }
    return loading;
}

function scheduleWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
        writeTimer = null;
        void PersistenceService.flush();
    }, WRITE_DELAY_MS);
}

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

            const settings = await readSettingsFile();
            cache = { ...settings, ...(cache ?? {}) };

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

    /** Save a specific key-value pair to disk (written shortly after, with other changes) */
    saveItem: async (key: string, value: any) => {
        if (!isDesktop()) return;
        const settings = cache ?? await loadCache();
        settings[key] = value;
        scheduleWrite();
    },

    /** Remove item from disk. */
    removeItem: async (key: string) => {
        if (!isDesktop()) return;
        const settings = cache ?? await loadCache();
        if (!(key in settings)) return;
        delete settings[key];
        scheduleWrite();
    },

    /** Writes pending changes now; writes never overlap */
    flush: (): Promise<void> => {
        if (writeTimer) {
            clearTimeout(writeTimer);
            writeTimer = null;
        }
        writing = writing.then(async () => {
            if (!cache) return;
            try {
                await Filesystem.writeFile({
                    path: SETTINGS_FILE,
                    data: JSON.stringify(cache, null, 2),
                    directory: Directory.Data,
                    encoding: Encoding.UTF8
                });
            } catch (error) {
                console.error('Persistence: Failed to save settings', error);
            }
        });
        return writing;
    },

    /** For tests: forget the in-memory copy */
    resetForTests: () => {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = null;
        cache = null;
        loading = null;
        writing = Promise.resolve();
    }
};

// Pending changes are written before the window goes away
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => { if (writeTimer) void PersistenceService.flush(); });
}

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
