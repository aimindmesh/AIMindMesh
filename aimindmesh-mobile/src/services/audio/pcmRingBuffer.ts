/**
 * Keeps the most recent part of a recording in memory, addressed by absolute sample offset:
 * the index of the sample in the recorded file. Callers can keep using absolute offsets
 * however long the meeting runs, even after old audio has been dropped.
 */
export class PcmRingBuffer {
    private chunks: Float32Array[] = [];
    private startOffset = 0;
    private length = 0;

    /** @param maxSamples minimum number of most recent samples kept */
    constructor(private readonly maxSamples: number) { }

    /** Absolute offset of the oldest sample held. */
    get start(): number {
        return this.startOffset;
    }

    /** Absolute offset just past the newest sample held. */
    get end(): number {
        return this.startOffset + this.length;
    }

    reset(offset = 0): void {
        this.chunks = [];
        this.startOffset = offset;
        this.length = 0;
    }

    /**
     * Appends samples whose first sample has absolute index `offset`. A small gap (lost chunks)
     * is filled with silence so offsets stay exact; a gap larger than the buffer restarts it.
     * Samples overlapping what is already held are ignored.
     */
    push(offset: number, samples: Float32Array): void {
        if (samples.length === 0) return;

        if (this.length === 0) {
            this.startOffset = offset;
        } else if (offset > this.end) {
            const gap = offset - this.end;
            if (gap >= this.maxSamples) {
                this.reset(offset);
            } else {
                this.append(new Float32Array(gap));
            }
        } else if (offset < this.end) {
            const overlap = this.end - offset;
            if (overlap >= samples.length) return;
            samples = samples.subarray(overlap);
        }

        this.append(samples);
    }

    /** Copies the samples in [from, to), clamped to what is held. */
    read(from: number, to: number): { offset: number; samples: Float32Array } {
        const a = Math.max(from, this.start);
        const b = Math.min(to, this.end);
        if (b <= a) {
            return { offset: Math.min(Math.max(from, this.start), this.end), samples: new Float32Array(0) };
        }

        const result = new Float32Array(b - a);
        let chunkStart = this.startOffset;
        for (const chunk of this.chunks) {
            const chunkEnd = chunkStart + chunk.length;
            if (chunkEnd > a && chunkStart < b) {
                const from = Math.max(a, chunkStart) - chunkStart;
                const to = Math.min(b, chunkEnd) - chunkStart;
                result.set(chunk.subarray(from, to), chunkStart + from - a);
            }
            if (chunkEnd >= b) break;
            chunkStart = chunkEnd;
        }
        return { offset: a, samples: result };
    }

    private append(samples: Float32Array): void {
        this.chunks.push(samples);
        this.length += samples.length;
        while (this.chunks.length > 1 && this.length - this.chunks[0].length >= this.maxSamples) {
            const dropped = this.chunks.shift()!;
            this.length -= dropped.length;
            this.startOffset += dropped.length;
        }
    }
}
