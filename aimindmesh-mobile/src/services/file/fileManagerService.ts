import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { logger } from '../logger';

// Standard directories for different model types
export const FILE_DIRECTORIES = {
    VOSK: 'vosk-models',
    WHISPER: 'whisper-models',
    WAKEWORD: 'wakeword-models',
    PIPER: 'piper-voices',
    MODELS: 'models', // GGUF, LiteRT, etc.
    VAD: 'vad-models',
    RECORDINGS: 'meeting-audio' // For reference
};

export interface AppFile {
    name: string;
    path: string;
    size: number;
    type: 'file' | 'directory';
    mtime: number; // Modification time
    category: string; // inferred from directory
}

export class FileManagerService {

    /**
     * List all files in a specific category directory
     */
    async listFiles(categoryDirectory: string): Promise<AppFile[]> {
        try {
            const result = await Filesystem.readdir({
                path: categoryDirectory,
                directory: Directory.Data
            });

            return Promise.all(result.files.map(async (file) => {
                // Get more info if possible (size, mtime)
                // readdir result gives Basic properties.
                // We might need stat for details, but it's expensive for many files.
                // Let's use what we have or do a quick stat if needed.
                // The 'file' object from readdir has: name, type, uri, mtime(sometimes), size(sometimes)

                return {
                    name: file.name,
                    path: `${categoryDirectory}/${file.name}`,
                    size: file.size || 0,
                    type: file.type,
                    mtime: file.mtime || 0,
                    category: categoryDirectory
                };
            }));
        } catch (e) {
            logger.log('warn', `[FileManager] Failed to list ${categoryDirectory}`, e);
            return [];
        }
    }

    /**
     * List all files across all known model directories
     */
    async listAllFiles(): Promise<AppFile[]> {
        const allFiles: AppFile[] = [];
        const dirs = Object.values(FILE_DIRECTORIES);

        for (const dir of dirs) {
            const files = await this.listFiles(dir);
            allFiles.push(...files);
        }

        return allFiles;
    }

    /**
     * Rename a file
     */
    async renameFile(categoryDirectory: string, oldName: string, newName: string): Promise<boolean> {
        try {
            await Filesystem.rename({
                from: `${categoryDirectory}/${oldName}`,
                to: `${categoryDirectory}/${newName}`,
                directory: Directory.Data,
                toDirectory: Directory.Data
            });
            logger.log('info', `[FileManager] Renamed ${oldName} to ${newName}`);
            return true;
        } catch (e) {
            logger.log('error', `[FileManager] Rename failed`, e);
            throw e;
        }
    }

    /**
     * Delete a file or directory
     */
    async deleteFile(path: string): Promise<boolean> {
        try {
            // Check if it's a directory first to use rmdir? 
            // Filesystem.deleteFile might allow deleting directories if recursive is set?
            // Actually deleteFile is for files. rmdir for directories.
            // We need to know the type.

            // Try deleteFile first
            try {
                await Filesystem.deleteFile({
                    path,
                    directory: Directory.Data
                });
            } catch (fileError) {
                // If failed, try rmdir (recursive)
                await Filesystem.rmdir({
                    path,
                    directory: Directory.Data,
                    recursive: true
                });
            }

            logger.log('info', `[FileManager] Deleted ${path}`);
            return true;
        } catch (e) {
            logger.log('error', `[FileManager] Delete failed`, e);
            throw e;
        }
    }

    /**
     * Move a file to a different category/directory
     */
    async moveFile(path: string, targetDirectory: string): Promise<boolean> {
        const fileName = path.split('/').pop();
        if (!fileName) return false;

        try {
            await Filesystem.rename({
                from: path,
                to: `${targetDirectory}/${fileName}`,
                directory: Directory.Data,
                toDirectory: Directory.Data
            });
            return true;
        } catch (e) {
            logger.log('error', `[FileManager] Move failed`, e);
            throw e;
        }
    }
}

export const fileManagerService = new FileManagerService();
