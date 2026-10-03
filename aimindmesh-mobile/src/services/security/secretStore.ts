/**
 * Secret store: API keys outside localStorage.
 *
 * - Android with Keystore encryption: secrets live in the native SecureStorage plugin
 *   (EncryptedSharedPreferences). They are read once at startup (initSecretStore, before
 *   the first render) into an in-memory cache, so reads stay synchronous; writes go to
 *   the plugin asynchronously.
 * - Desktop (Tauri): secrets live in `secrets.json`, separate from app-settings.json.
 * - Web, or Android without working encryption: nothing changes, secrets stay in
 *   localStorage as before (backend 'plain').
 *
 * A plain copy is removed only after the secure write was confirmed (the native side
 * commits and reads it back; the desktop file is read back too).
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isDesktop } from '../../utils/platform';
import { FileSystemAdapter as Filesystem, Directory, Encoding } from '../../utils/fileSystemAdapter';
import { PersistenceService } from '../config/persistenceService';
import { ALL_SECRET_IDS, SECRET_FIELDS, SECRET_KEYS, extractSecrets, hasSecrets, mergeSecrets, stripSecrets } from './secretFields';

interface SecureStoragePlugin {
    status(): Promise<{ encrypted: boolean; hardwareBacked: boolean }>;
    set(opts: { key: string; value: string }): Promise<void>;
    getMany(opts: { keys: string[] }): Promise<{ values: Record<string, string> }>;
    remove(opts: { key: string }): Promise<void>;
}

const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage');

type Backend = 'keystore' | 'file' | 'plain';

const SECRETS_FILE = 'secrets.json';
// Ids written by the old native migration (ApiKeyMigration.kt): adopted when found
const LEGACY_IDS: Record<string, string> = {
    gemini_api_key: 'gemini-api-key',
    perplexity_api_key: 'perplexity-api-key',
    claude_api_key: 'claude-api-key',
    hf_token: 'hf-token',
};

let backend: Backend = 'plain';
let hardwareBacked = false;
/** Values to use now (confirmed or being written) */
const cache = new Map<string, string>();
/** Values confirmed in the durable store */
const persisted = new Map<string, string>();
/** Last value handed to storeSetting per key: a late confirmation never overwrites a newer write */
const latest = new Map<string, unknown>();

export const isSecureBackend = () => backend !== 'plain';
export const secretStoreStatus = () => ({ backend, hardwareBacked });

/** Secret value, or undefined when the store does not hold it (plain backend, never saved). */
export const getSecret = (id: string): string | undefined => (backend === 'plain' ? undefined : cache.get(id));

async function readSecretsFile(): Promise<Record<string, string>> {
    try {
        const result = await Filesystem.readFile({ path: SECRETS_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
        return JSON.parse(result.data as string);
    } catch {
        return {};
    }
}

/** Writes one secret durably; resolves only once it can be read back. */
async function persist(id: string, value: string): Promise<void> {
    if (backend === 'keystore') {
        await SecureStorage.set({ key: id, value }); // the native side commits and verifies
    } else if (backend === 'file') {
        const next = { ...Object.fromEntries(persisted), [id]: value };
        await Filesystem.writeFile({ path: SECRETS_FILE, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(next, null, 2) });
        if ((await readSecretsFile())[id] !== value) throw new Error(`secrets.json write of ${id} not verified`);
    }
    persisted.set(id, value);
}

function writePlainCopy(key: string, value: unknown, toDisk: boolean) {
    if (value === undefined) {
        localStorage.removeItem(key);
        if (toDisk) void PersistenceService.removeItem(key);
    } else {
        localStorage.setItem(key, JSON.stringify(value));
        if (toDisk) void PersistenceService.saveItem(key, value);
    }
}

/**
 * Writes a setting to localStorage (and app-settings.json on desktop), with its secrets
 * kept in the secret store. Until a new secret is confirmed, localStorage keeps the full
 * value, so nothing is lost if the app stops meanwhile (the next start migrates it).
 */
export function storeSetting(key: string, value: unknown): void {
    latest.set(key, value);
    if (backend === 'plain' || !hasSecrets(key) || value === undefined) {
        writePlainCopy(key, value, true);
        return;
    }

    const unsaved = Object.entries(extractSecrets(key, value)).filter(([id, secret]) => persisted.get(id) !== secret);
    const stripped = stripSecrets(key, value);
    if (unsaved.length === 0) {
        writePlainCopy(key, stripped, true);
        return;
    }

    unsaved.forEach(([id, secret]) => cache.set(id, secret));
    writePlainCopy(key, value, false);
    if (stripped !== undefined) void PersistenceService.saveItem(key, stripped); // the file never gets the secret
    else void PersistenceService.removeItem(key);

    Promise.all(unsaved.map(([id, secret]) => persist(id, secret)))
        .then(() => {
            if (latest.get(key) === value) writePlainCopy(key, stripped, false);
        })
        .catch(err => console.error(`[SecretStore] Secret of "${key}" not stored securely, kept in local storage`, err));
}

/** Reads a setting from localStorage with its secrets filled in (for code outside React state). */
export function readSetting<T>(key: string, fallback: T): T {
    let value: any = fallback;
    const raw = localStorage.getItem(key);
    if (raw !== null) {
        try {
            const parsed = JSON.parse(raw);
            value = typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback) && typeof parsed === 'object' && parsed !== null
                ? { ...fallback, ...parsed }
                : parsed;
        } catch {
            value = fallback;
        }
    }
    return mergeSecrets(key, value, getSecret);
}

/** Moves plain secrets found in localStorage to the secret store, key by key. */
async function migratePlainSecrets(): Promise<void> {
    for (const key of [...SECRET_KEYS, ...Object.keys(SECRET_FIELDS)]) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        let value: unknown;
        try {
            value = JSON.parse(raw);
        } catch {
            continue;
        }
        const found = Object.entries(extractSecrets(key, value)).filter(([, secret]) => secret !== '');
        if (found.length === 0) continue;
        try {
            for (const [id, secret] of found) {
                // A plain value is the latest one written (older app version, or not migrated yet)
                if (persisted.get(id) !== secret) await persist(id, secret);
                cache.set(id, secret);
            }
            writePlainCopy(key, stripSecrets(key, value), true);
            console.info(`[SecretStore] Secrets of "${key}" moved to the ${backend} store`);
        } catch (err) {
            console.error(`[SecretStore] Migration of "${key}" failed, plain copy kept`, err);
        }
    }
}

/** Loads the secret store. Must complete before the first render. Never throws. */
export async function initSecretStore(): Promise<void> {
    try {
        if (Capacitor.getPlatform() === 'android') {
            const status = await SecureStorage.status();
            if (!status.encrypted) {
                console.warn('[SecretStore] Keystore encryption unavailable: API keys stay in local storage');
                return;
            }
            hardwareBacked = status.hardwareBacked;
            const { values } = await SecureStorage.getMany({ keys: [...ALL_SECRET_IDS, ...Object.keys(LEGACY_IDS)] });
            backend = 'keystore';
            for (const id of ALL_SECRET_IDS) {
                if (typeof values[id] === 'string') persisted.set(id, values[id]);
            }
            for (const [legacy, id] of Object.entries(LEGACY_IDS)) {
                const value = values[legacy];
                if (value && !persisted.has(id) && localStorage.getItem(id) === null) {
                    await persist(id, value);
                    await SecureStorage.remove({ key: legacy }).catch(() => { /* adopted anyway */ });
                }
            }
        } else if (isDesktop()) {
            backend = 'file';
            for (const [id, value] of Object.entries(await readSecretsFile())) {
                if (ALL_SECRET_IDS.includes(id) && typeof value === 'string') persisted.set(id, value);
            }
        } else {
            return;
        }
        persisted.forEach((value, id) => cache.set(id, value));
        await migratePlainSecrets();
    } catch (err) {
        console.error('[SecretStore] Initialization failed: API keys stay in local storage', err);
        backend = 'plain';
        cache.clear();
        persisted.clear();
    }
}
