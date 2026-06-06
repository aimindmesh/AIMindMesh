import { Filesystem as CapFilesystem, WriteFileOptions, ReadFileOptions, ReaddirOptions } from '@capacitor/filesystem';
import { writeTextFile, readFile, readTextFile, readDir, BaseDirectory, mkdir, remove, stat, copyFile, rename } from '@tauri-apps/plugin-fs';
import { appDataDir, documentDir, cacheDir, join } from '@tauri-apps/api/path';
import { isDesktop } from './platform';

// Re-export Directory enum for compatibility
export enum Directory {
    Documents = 'DOCUMENTS',
    Data = 'DATA',
    Cache = 'CACHE',
    External = 'EXTERNAL',
    ExternalStorage = 'EXTERNAL_STORAGE'
}

// Re-export Encoding enum
export enum Encoding {
    UTF8 = 'utf8',
    ASCII = 'ascii',
    UTF16 = 'utf16',
}

/**
 * Maps Capacitor Directory enum to Tauri BaseDirectory enum.
 */
const getTauriBaseDirectory = (dir?: Directory | string): BaseDirectory => {
    switch (dir) {
        case Directory.Documents: return BaseDirectory.Document;
        case Directory.Data: return BaseDirectory.AppData;
        case Directory.Cache: return BaseDirectory.Cache;
        default: return BaseDirectory.AppData;
    }
};

export const FileSystemAdapter = {
    /**
     * Write a file.
     */
    writeFile: async (options: WriteFileOptions): Promise<void> => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            // ... strict logic ...
            if (typeof options.data === 'string') {
                await writeTextFile(options.path, options.data, { baseDir });
            } else {
                await writeTextFile(options.path, String(options.data), { baseDir });
            }
            return;
        }
        await CapFilesystem.writeFile(options);
    },

    /**
     * Read a file.
     */
    readFile: async (options: ReadFileOptions): Promise<{ data: string | Blob }> => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            if (options.encoding === Encoding.UTF8 || !options.encoding) {
                const data = await readTextFile(options.path, { baseDir });
                return { data };
            } else {
                const data = await readFile(options.path, { baseDir });
                return { data: new TextDecoder().decode(data) };
            }
        }
        return await CapFilesystem.readFile(options);
    },

    /**
     * Read directory.
     */
    readdir: async (options: ReaddirOptions): Promise<{ files: any[] }> => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            const entries = await readDir(options.path, { baseDir });
            const files = entries.map(e => ({
                name: e.name,
                type: e.isDirectory ? 'directory' : 'file',
            }));
            return { files };
        }
        return await CapFilesystem.readdir(options);
    },

    mkdir: async (options: { path: string, directory?: Directory, recursive?: boolean }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            await mkdir(options.path, { baseDir, recursive: options.recursive });
            return;
        }
        return await CapFilesystem.mkdir(options);
    },

    rmdir: async (options: { path: string, directory?: Directory, recursive?: boolean }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            await remove(options.path, { baseDir, recursive: options.recursive });
            return;
        }
        return await CapFilesystem.rmdir(options);
    },

    deleteFile: async (options: { path: string, directory?: Directory }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            await remove(options.path, { baseDir });
            return;
        }
        return await CapFilesystem.deleteFile(options);
    },

    stat: async (options: { path: string, directory?: Directory }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            const info = await stat(options.path, { baseDir });
            return {
                type: info.isDirectory ? 'directory' : 'file',
                size: info.size,
                ctime: info.birthtime ? new Date(info.birthtime).getTime() : 0,
                mtime: info.mtime ? new Date(info.mtime).getTime() : 0,
                uri: options.path
            };
        }
        return await CapFilesystem.stat(options);
    },

    rename: async (options: { from: string, to: string, directory?: Directory, toDirectory?: Directory }) => {
        if (isDesktop()) {
            const baseDirKey = options.directory ? getTauriBaseDirectory(options.directory) : BaseDirectory.AppData;
            const toBaseDirKey = options.toDirectory ? getTauriBaseDirectory(options.toDirectory) : baseDirKey;

            await rename(options.from, options.to, { oldPathBaseDir: baseDirKey, newPathBaseDir: toBaseDirKey });
            return;
        }
        return await CapFilesystem.rename(options);
    },

    copy: async (options: { from: string, to: string, directory?: Directory, toDirectory?: Directory }) => {
        if (isDesktop()) {
            const baseDirKey = options.directory ? getTauriBaseDirectory(options.directory) : BaseDirectory.AppData;
            const toBaseDirKey = options.toDirectory ? getTauriBaseDirectory(options.toDirectory) : baseDirKey;
            await copyFile(options.from, options.to, { fromPathBaseDir: baseDirKey, toPathBaseDir: toBaseDirKey });
            return;
        }
        return await CapFilesystem.copy(options);
    },

    getUri: async (options: { path: string, directory: Directory }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);

            let basePath = '';
            switch (baseDir) {
                case BaseDirectory.AppData: basePath = await appDataDir(); break;
                case BaseDirectory.Document: basePath = await documentDir(); break;
                case BaseDirectory.Cache: basePath = await cacheDir(); break;
                default: basePath = await appDataDir();
            }
            const fullPath = await join(basePath, options.path);
            return { uri: fullPath };
        }
        return await CapFilesystem.getUri(options);
    },

    appendFile: async (options: { path: string, data: string, directory?: Directory, encoding?: Encoding }) => {
        if (isDesktop()) {
            const baseDir = getTauriBaseDirectory(options.directory);
            let current = '';
            try {
                current = await readTextFile(options.path, { baseDir });
            } catch (e) { /* ignore */ }

            await writeTextFile(options.path, current + options.data, { baseDir });
            return;
        }
        return await CapFilesystem.appendFile(options);
    }
};
