/**
 * Line splitting for streamed HTTP bodies (NDJSON, server-sent events).
 * A network chunk can end in the middle of a line or of a multi-byte character:
 * the remainder waits for the next chunk instead of being parsed (and dropped) alone.
 */
export function createLineDecoder() {
    const decoder = new TextDecoder();
    let buffer = '';
    return {
        /** Complete lines contained in the body so far */
        push(chunk: Uint8Array): string[] {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            return lines;
        },
        /** The last line once the body ended (sent without a final newline) */
        end(): string[] {
            buffer += decoder.decode();
            const rest = buffer;
            buffer = '';
            return rest.trim() ? [rest] : [];
        },
    };
}

/** Payload of a server-sent event line ("data: ..."), or null for any other line */
export function parseSseData(line: string): string | null {
    const clean = line.replace(/\r$/, '');
    if (!clean.startsWith('data:')) return null;
    return clean.slice(5).trimStart();
}
