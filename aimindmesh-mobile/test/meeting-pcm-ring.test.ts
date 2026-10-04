import { describe, expect, it } from 'vitest';
import { PcmRingBuffer } from '../src/services/audio/pcmRingBuffer';

/** Samples whose value is their absolute offset, to check positions after reads. */
function ramp(offset: number, length: number): Float32Array {
    return Float32Array.from({ length }, (_, i) => offset + i);
}

describe('PcmRingBuffer', () => {
    it('reads across chunk boundaries with absolute offsets', () => {
        const buf = new PcmRingBuffer(100);
        buf.push(0, ramp(0, 10));
        buf.push(10, ramp(10, 10));

        const { offset, samples } = buf.read(5, 15);

        expect(offset).toBe(5);
        expect(Array.from(samples)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it('drops old chunks but keeps at least maxSamples, and offsets stay absolute', () => {
        const buf = new PcmRingBuffer(25);
        for (let i = 0; i < 10; i++) buf.push(i * 10, ramp(i * 10, 10));

        expect(buf.end).toBe(100);
        expect(buf.end - buf.start).toBeGreaterThanOrEqual(25);
        expect(buf.start).toBe(70);
        expect(Array.from(buf.read(95, 100).samples)).toEqual([95, 96, 97, 98, 99]);
    });

    it('clamps a read that starts before the oldest sample held', () => {
        const buf = new PcmRingBuffer(20);
        for (let i = 0; i < 10; i++) buf.push(i * 10, ramp(i * 10, 10));

        const { offset, samples } = buf.read(0, 85);

        expect(offset).toBe(buf.start);
        expect(samples[0]).toBe(buf.start);
        expect(offset + samples.length).toBe(85);
    });

    it('keeps serving new audio long after the buffer filled up', () => {
        // Regression: live Whisper stopped after 5 minutes because offsets were relative to
        // the trimmed buffer instead of the recording.
        const buf = new PcmRingBuffer(50);
        let consumed = 0;
        for (let i = 0; i < 100; i++) {
            buf.push(i * 10, ramp(i * 10, 10));
            const { offset, samples } = buf.read(consumed, buf.end);
            expect(offset).toBe(consumed);
            consumed = offset + samples.length;
        }
        expect(consumed).toBe(1000);
    });

    it('fills a small gap with silence so later offsets stay exact', () => {
        const buf = new PcmRingBuffer(100);
        buf.push(0, ramp(0, 10));
        buf.push(15, ramp(15, 5));

        expect(Array.from(buf.read(8, 17).samples)).toEqual([8, 9, 0, 0, 0, 0, 0, 15, 16]);
    });

    it('restarts on a gap larger than the buffer', () => {
        const buf = new PcmRingBuffer(20);
        buf.push(0, ramp(0, 10));
        buf.push(1000, ramp(1000, 10));

        expect(buf.start).toBe(1000);
        expect(buf.end).toBe(1010);
    });

    it('ignores samples it already holds', () => {
        const buf = new PcmRingBuffer(100);
        buf.push(0, ramp(0, 10));
        buf.push(5, ramp(5, 10));

        expect(buf.end).toBe(15);
        expect(Array.from(buf.read(0, 15).samples)).toEqual(Array.from(ramp(0, 15)));
    });

    it('returns an empty read outside the held range', () => {
        const buf = new PcmRingBuffer(100);
        buf.push(0, ramp(0, 10));

        const { offset, samples } = buf.read(10, 20);

        expect(samples.length).toBe(0);
        expect(offset).toBe(10);
    });
});
