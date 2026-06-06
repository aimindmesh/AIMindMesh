/**
 * Utility functions for string manipulation
 */

/**
 * Extracts a clean model name from a file path or URL-encoded string.
 * Handles decoding of URI components and removal of common model file extensions.
 * 
 * @param path The full path or filename of the model
 * @returns The clean model name (filename without extension)
 */
export const getCleanModelName = (path: string): string => {
    if (!path) return '';

    try {
        // Decode URI components (e.g., %3A -> :)
        let cleanPath = decodeURIComponent(path);

        // Remove common prefixes
        cleanPath = cleanPath.replace(/^primary:/, '').replace(/^raw:/, '').replace(/^file:\/\//, '').replace(/^content:\/\//, '');

        // Extract filename from path
        // precise split to handle both / and \ just in case, though usually / in JS
        const parts = cleanPath.split(/[/\\]/);
        let filename = parts.pop() || cleanPath;

        // Remove known extensions
        const extensions = [
            '.gguf',
            '.tflite',
            '.onnx',
            '.litertlm',
            '.task',
            '.bin',
            '.zip'
        ];

        // Case-insensitive replacement
        for (const ext of extensions) {
            if (filename.toLowerCase().endsWith(ext)) {
                filename = filename.slice(0, -ext.length);
                break; // Only remove the last extension
            }
        }

        return filename;
    } catch (e) {
        // Fallback to original path if anything goes wrong
        return path;
    }
};
