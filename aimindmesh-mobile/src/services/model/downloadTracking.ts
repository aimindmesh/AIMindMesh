import { registerPlugin } from '@capacitor/core';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import type { ModelDownloadProgress } from './modelDownloader';

/**
 * Tracking of native GGUF downloads (LlamaCpp plugin): progress polling, resume after the
 * settings screen is reopened, and verification of the finished file.
 */
const LlamaCpp = registerPlugin('LlamaCpp') as any;

/** HuggingFace page links (blob) point to HTML: the file itself is under resolve */
export function normalizeDownloadUrl(url: string): string {
    return url.includes('huggingface.co') && url.includes('/blob/') ? url.replace('/blob/', '/resolve/') : url;
}

/** Polls in a row that may fail before a tracked download is given up (500 ms each) */
const MAX_POLL_ERRORS = 20;

/**
 * Checks a finished download against the size the server announced.
 * Returns the error to report, or null when the file is acceptable.
 */
export function checkDownloadedSize(actualBytes: number, expectedBytes: number): string | null {
    if (actualBytes < 1024) return `File too small (${actualBytes} bytes, likely an error page)`;
    if (expectedBytes > 0 && actualBytes !== expectedBytes) {
        return `Incomplete file: ${actualBytes} of ${expectedBytes} bytes`;
    }
    return null;
}

/**
 * The plugin answers for unknown URLs with a placeholder ({ progress: 0, completed: false }):
 * only a real download status carries the byte counters.
 */
export function isTrackedStatus(status: any): boolean {
    return !!status && typeof status.bytesDownloaded === 'number';
}

/** Progress shape of a native download status, as reported to the UI */
export function toDownloadProgress(status: any): ModelDownloadProgress {
    const totalBytes = status?.totalBytes || 0;
    const bytesDownloaded = status?.bytesDownloaded || 0;
    return {
        bytesDownloaded,
        totalBytes,
        percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
        completed: !!status?.completed,
        failed: !!status?.failed,
        errorMessage: status?.error || undefined,
    };
}

/**
 * Native status of a download started earlier (e.g. before the settings screen was reopened),
 * or null when the plugin knows no download for this URL.
 */
export async function getDownloadStatus(url: string): Promise<(ModelDownloadProgress & { cancelled: boolean }) | null> {
    try {
        const status = await LlamaCpp.getDownloadProgress({ url: normalizeDownloadUrl(url) });
        if (!isTrackedStatus(status)) return null;
        return { ...toDownloadProgress(status), cancelled: !!status.cancelled };
    } catch {
        return null;
    }
}

/**
 * Follows a native download until it ends, then verifies the file.
 * Resolves with the local file name, rejects on failure, cancel or a bad file.
 */
export function trackDownload(
    url: string,
    filename: string,
    onProgress?: (progress: ModelDownloadProgress) => void
): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let pollErrors = 0;
        let lastTotal = 0;
        let settled = false; // a slow poll can still answer after the end was handled
        const progressInterval = setInterval(async () => {
            try {
                const progress = await LlamaCpp.getDownloadProgress({ url: normalizeDownloadUrl(url) });
                if (settled) return;
                if (!isTrackedStatus(progress)) {
                    // The plugin forgot the download (cancelled, or the app restarted): stop waiting
                    if (++pollErrors >= 4) {
                        settled = true;
                        clearInterval(progressInterval);
                        reject(new Error('Download cancelled'));
                    }
                    return;
                }
                pollErrors = 0;
                const report = toDownloadProgress(progress);
                if (report.totalBytes > 0) lastTotal = report.totalBytes;
                onProgress?.(report);

                if (progress.completed) {
                    settled = true;
                    clearInterval(progressInterval);
                    // The native side renames the file only once complete: verify what landed
                    Filesystem.stat({ path: filename, directory: Directory.Data }).then(stat => {
                        const problem = checkDownloadedSize(stat.size, lastTotal);
                        if (problem) {
                            console.error('[ModelDownloader] Rejecting downloaded file:', problem);
                            Filesystem.deleteFile({ path: filename, directory: Directory.Data }).catch(() => { });
                            reject(new Error(`Download failed: ${problem}`));
                        } else {
                            resolve(filename);
                        }
                    }).catch(e => {
                        // Stat unavailable (e.g. desktop adapter): do not hang the caller
                        console.warn('Failed to verify file size', e);
                        resolve(filename);
                    });
                } else if (progress.failed || progress.cancelled) {
                    settled = true;
                    clearInterval(progressInterval);
                    console.error('[ModelDownloader] Download failed or cancelled:', progress.error);
                    reject(new Error(progress.error || 'Download cancelled'));
                }
            } catch (error) {
                // A few failed polls are tolerated; a plugin that stopped answering is not
                if (settled) return;
                if (++pollErrors >= MAX_POLL_ERRORS) {
                    settled = true;
                    clearInterval(progressInterval);
                    reject(new Error('Download progress unavailable'));
                } else {
                    console.warn('[ModelDownloader] Error polling progress:', error);
                }
            }
        }, 500);
    });
}
