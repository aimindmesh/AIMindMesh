/**
 * Embedding vectors are stored as the raw bytes of a Float32Array in BLOB columns
 * (memories.embedding, document_chunks.embedding). Writes inline them as X'hex' literals;
 * reads select hex(embedding), a compact string, instead of the plugin's default BLOB
 * representation (a JSON array with one number per byte).
 */

const BYTE_TO_HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Hex of the vector's own bytes (respects byteOffset: views into larger buffers are safe). */
export function float32ToHex(vector: Float32Array): string {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += BYTE_TO_HEX[bytes[i]];
    return hex;
}

function hexValue(code: number): number {
    if (code >= 48 && code <= 57) return code - 48;       // 0-9
    if (code >= 97 && code <= 102) return code - 87;      // a-f
    if (code >= 65 && code <= 70) return code - 55;       // A-F (SQLite hex() is uppercase)
    return 0;
}

/** Bytes to floats; a trailing partial float (corrupt value) is dropped instead of throwing. */
function bytesToFloat32(bytes: Uint8Array): Float32Array {
    const usable = bytes.length - (bytes.length % 4);
    const copy = new Uint8Array(usable);
    copy.set(bytes.subarray(0, usable));
    return new Float32Array(copy.buffer);
}

/**
 * Decode a stored embedding: hex string, Uint8Array or byte array (the plugin's BLOB form,
 * bytes may be signed). Missing values decode to an empty vector, which scores 0.
 */
export function blobToFloat32Array(blob: unknown): Float32Array {
    if (blob == null) return new Float32Array(0);
    if (blob instanceof Uint8Array) return bytesToFloat32(blob);
    if (typeof blob === 'string') {
        const bytes = new Uint8Array(blob.length >> 1);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = (hexValue(blob.charCodeAt(2 * i)) << 4) | hexValue(blob.charCodeAt(2 * i + 1));
        }
        return bytesToFloat32(bytes);
    }
    if (Array.isArray(blob)) return bytesToFloat32(Uint8Array.from(blob as number[], b => b & 0xff));
    return new Float32Array(0);
}

/** Cosine similarity; vectors of different length (different models) score 0. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return (normA === 0 || normB === 0) ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
