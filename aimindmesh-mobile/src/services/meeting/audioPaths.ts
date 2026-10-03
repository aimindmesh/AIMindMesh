/**
 * Path helpers for meeting audio. Native plugins take plain filesystem paths while Capacitor's
 * Filesystem returns file:// URIs: passing one where the other was expected made reprocessing
 * open a file that does not exist.
 */

/** Plain absolute path from a file:// URI (a plain path is returned unchanged). */
export function toNativePath(pathOrUri: string): string {
    if (!pathOrUri.startsWith('file://')) return pathOrUri;
    const withoutScheme = pathOrUri.slice('file://'.length);
    try {
        return decodeURIComponent(withoutScheme);
    } catch {
        return withoutScheme;
    }
}

/**
 * Path relative to the app's internal files dir (Filesystem Directory.Data), or null when the
 * file lives elsewhere. Recordings are written by the native side under getFilesDir().
 */
export function toDataRelativePath(pathOrUri: string): string | null {
    const plain = toNativePath(pathOrUri);
    if (!plain.startsWith('/')) return plain;
    const marker = '/files/';
    const index = plain.indexOf(marker);
    return index >= 0 ? plain.slice(index + marker.length) : null;
}

/** Recordings are AAC in an MP4 container, unless the native encoder fell back to WAV. */
export function guessAudioMimeType(path: string): string {
    return path.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mp4';
}

export function audioExtensionForMime(mimeType: string | null | undefined): string {
    if (!mimeType) return 'm4a';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'm4a';
}
