import { describe, expect, it } from 'vitest';
import { blobToFloat32Array, cosineSimilarity, float32ToHex } from '../src/services/memory/embeddingCodec';

describe('embedding codec', () => {
    it('round-trips vectors through hex, including SQLite uppercase hex()', () => {
        const vector = new Float32Array([0.5, -1.25, 3e-7, 42]);
        const hex = float32ToHex(vector);
        expect(hex).toHaveLength(32);
        expect(Array.from(blobToFloat32Array(hex))).toEqual(Array.from(vector));
        expect(Array.from(blobToFloat32Array(hex.toUpperCase()))).toEqual(Array.from(vector));
    });

    it('encodes only the bytes of a view (byteOffset)', () => {
        const backing = new Float32Array([9, 9, 1.5, 2.5, 9]);
        const view = backing.subarray(2, 4);
        expect(Array.from(blobToFloat32Array(float32ToHex(view)))).toEqual([1.5, 2.5]);
    });

    it('decodes the plugin BLOB forms: byte arrays (signed or not) and Uint8Array views', () => {
        const vector = new Float32Array([1, -2]);
        const bytes = Array.from(new Uint8Array(vector.buffer));
        const signed = bytes.map(b => (b > 127 ? b - 256 : b));
        expect(Array.from(blobToFloat32Array(bytes))).toEqual([1, -2]);
        expect(Array.from(blobToFloat32Array(signed))).toEqual([1, -2]);

        const padded = new Uint8Array(12);
        padded.set(new Uint8Array(vector.buffer), 4);
        expect(Array.from(blobToFloat32Array(padded.subarray(4)))).toEqual([1, -2]);
    });

    it('never throws on missing or truncated values', () => {
        expect(blobToFloat32Array(null)).toHaveLength(0);
        expect(blobToFloat32Array(undefined)).toHaveLength(0);
        expect(blobToFloat32Array([1, 2, 3, 4, 5])).toHaveLength(1);
    });

    it('scores vectors of different dimension (different models) as 0', () => {
        expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0);
        expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBe(0);
        expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([2, 4]))).toBeCloseTo(1);
    });
});
