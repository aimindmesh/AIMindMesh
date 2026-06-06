import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { getCleanModelName } from '../../utils/stringUtils';
import { logger } from '../logger';
import { isDesktop } from '../../utils/platform';

export interface ImportResult {
    path: string;
    originalName: string;
    cleanName: string;
    size: number;
    mimeType: string;
    success: boolean;
    error?: string;
}

export interface FileImportOptions {
    /**
     * MIME types to allow
     */
    types?: string[];
    /**
     * Allowed file extensions (without dot, e.g. ['zip', 'bin'])
     */
    extensions?: string[];
    /**
     * Destination directory (relative to Data directory)
     * e.g., 'vosk-models', 'whisper-models'
     */
    destinationDirectory: string;
    /**
     * Whether to unzip the file after import (if it's a zip)
     * Note: extraction is currently handled by specific plugins or requires a zip plugin
     */
    unzip?: boolean;
    /**
     * Optional custom filename (if not provided, will be cleaned from original)
     */
    customFileName?: string;
}

/**
 * Service to handle file imports centrally.
 * Ensures filenames are sanitized and decoded properly.
 */
export class FileImportService {

    /**
     * Pick a file and return its details without importing.
     * Use this when you need plugin-specific import logic (e.g. Vosk unzipping).
     */
    async pickFile(options: FileImportOptions): Promise<ImportResult> {
        try {
            logger.log('info', `[FileImportService] Picking file (no-import)`);

            if (isDesktop()) {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const { stat } = await import('@tauri-apps/plugin-fs');

                const selected = await open({
                    multiple: false,
                    filters: options.extensions ? [{
                        name: 'Allowed Files',
                        extensions: options.extensions
                    }] : undefined
                });

                if (selected === null) {
                    throw new Error('No file selected');
                }

                const path = selected as string;
                const originalName = path.split(/[/\\]/).pop() || `imported_${Date.now()}`;

                let size = 0;
                try {
                    const info = await stat(path);
                    size = info.size;
                } catch (e) {
                    logger.log('warn', 'Failed to get file stats', e);
                }

                // Determine clean filename
                let cleanName = options.customFileName;
                if (!cleanName) {
                    cleanName = getCleanModelName(originalName);
                    const originalExt = originalName.split('.').pop()?.toLowerCase();
                    if (originalExt && !cleanName.toLowerCase().endsWith(`.${originalExt}`)) {
                        cleanName = `${cleanName}.${originalExt}`;
                    }
                }

                return {
                    path,
                    originalName,
                    cleanName,
                    size,
                    mimeType: 'application/octet-stream', // Generic fallback
                    success: true
                };
            }

            const result = await FilePicker.pickFiles({
                types: options.types || [],
                readData: false
            });

            if (!result.files || result.files.length === 0) {
                throw new Error('No file selected');
            }

            const file = result.files[0];
            const originalName = file.name || `imported_${Date.now()}`;
            const mimeType = file.mimeType || '';
            const size = file.size || 0;
            const sourcePath = file.path;

            if (!sourcePath) {
                throw new Error('File path not available');
            }

            // Validate extension if needed
            if (options.extensions && options.extensions.length > 0) {
                const ext = originalName.split('.').pop()?.toLowerCase();
                if (!ext || !options.extensions.includes(ext)) {
                    throw new Error(`Invalid file type. Allowed: ${options.extensions.join(', ')}`);
                }
            }

            // Determine clean filename
            let cleanName = options.customFileName;
            if (!cleanName) {
                cleanName = getCleanModelName(originalName);

                // Re-append extension if needed
                const originalExt = originalName.split('.').pop()?.toLowerCase();
                if (originalExt && !cleanName.toLowerCase().endsWith(`.${originalExt}`)) {
                    cleanName = `${cleanName}.${originalExt}`;
                }
            }

            return {
                path: sourcePath, // Return source path for the caller to use
                originalName,
                cleanName,
                size,
                mimeType,
                success: true
            };

        } catch (error) {
            logger.log('error', '[FileImportService] Pick failed', error);
            return {
                path: '',
                originalName: '',
                cleanName: '',
                size: 0,
                mimeType: '',
                success: false,
                error: (error as any).message || 'Unknown error'
            };
        }
    }

    /**
     * Pick a file and import it to the specified directory with a clean name.
     */
    async importFile(options: FileImportOptions): Promise<ImportResult> {
        try {
            logger.log('info', `[FileImportService] Picking file for ${options.destinationDirectory}`);

            const result = await FilePicker.pickFiles({
                types: options.types || [],
                readData: false
            });

            if (!result.files || result.files.length === 0) {
                throw new Error('No file selected');
            }

            const file = result.files[0];
            const originalName = file.name || `imported_${Date.now()}`;
            const mimeType = file.mimeType || '';
            const size = file.size || 0;
            const sourcePath = file.path;

            if (!sourcePath) {
                throw new Error('File path not available');
            }

            // Validate extension if needed
            if (options.extensions && options.extensions.length > 0) {
                const ext = originalName.split('.').pop()?.toLowerCase();
                if (!ext || !options.extensions.includes(ext)) {
                    throw new Error(`Invalid file type. Allowed: ${options.extensions.join(', ')}`);
                }
            }

            // Determine clean filename
            let cleanName = options.customFileName;
            if (!cleanName) {
                cleanName = getCleanModelName(originalName);

                // Ensure extension is preserved if getCleanModelName stripped it but we need it for the file
                // actually getCleanModelName strips extensions for model IDs, but here we might want the file extension
                // Let's re-append the extension if it was stripped and we are saving a file
                const originalExt = originalName.split('.').pop()?.toLowerCase();
                if (originalExt && !cleanName.toLowerCase().endsWith(`.${originalExt}`)) {
                    cleanName = `${cleanName}.${originalExt}`;
                }
            }

            // Ensure destination directory exists
            await this.ensureDirectory(options.destinationDirectory);

            const targetPath = `${options.destinationDirectory}/${cleanName}`;

            logger.log('info', `[FileImportService] Importing to ${targetPath}`);

            // Perform the copy
            // We use a workaround for content:// URIs if needed, but Filesystem.copy usually handles them on newer Capacitor versions
            // However, for large files, the native copier in plugins was more reliable.
            // Let's try standard Filesystem copy first.

            try {
                await Filesystem.copy({
                    from: sourcePath,
                    to: targetPath,
                    directory: Directory.Data, // 'to' is relative to Data
                    // 'from' is absolute path (native path)
                });
            } catch (copyError) {
                // If standard copy fails (e.g. content URI permission issues on some Androids),
                // we might need a fallback. But for now let's assume it works or throw.
                // The specialized downloaders used plugin-specific copy methods.
                // We might want to unify that or keep using them if they are more robust.
                // For this service to be generic, it should probably use the Capacitor Filesystem.
                logger.log('error', '[FileImportService] Filesystem copy failed', copyError);
                throw new Error(`Failed to copy file: ${(copyError as any).message}`);
            }

            return {
                path: targetPath,
                originalName,
                cleanName,
                size,
                mimeType,
                success: true
            };

        } catch (error) {
            logger.log('error', '[FileImportService] Import failed', error);
            return {
                path: '',
                originalName: '',
                cleanName: '',
                size: 0,
                mimeType: '',
                success: false,
                error: (error as any).message || 'Unknown error'
            };
        }
    }

    /**
     * Ensure a directory exists
     */
    private async ensureDirectory(path: string): Promise<void> {
        try {
            await Filesystem.mkdir({
                path,
                directory: Directory.Data,
                recursive: true
            });
        } catch (e) {
            // Ignore if exists
        }
    }
}

export const fileImportService = new FileImportService();
