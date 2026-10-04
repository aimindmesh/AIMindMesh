package com.aimindmesh.mobile.utils;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import org.junit.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class PcmResamplerTest {

    private static byte[] pcm(short... samples) {
        ByteBuffer bb = ByteBuffer.allocate(samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
        for (short s : samples) bb.putShort(s);
        return bb.array();
    }

    private static short[] samples(byte[] bytes) {
        ByteBuffer bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        short[] out = new short[bytes.length / 2];
        for (int i = 0; i < out.length; i++) out[i] = bb.getShort();
        return out;
    }

    @Test
    public void sixteenKhzMonoPassesThrough() {
        byte[] in = pcm((short) 1, (short) 2, (short) 3);
        assertSame(in, new AudioDecoder.PcmResampler(16000, 1).process(in, in.length));
    }

    @Test
    public void stereoIsAveragedToMono() {
        short[] out = samples(new AudioDecoder.PcmResampler(16000, 2).process(pcm((short) 100, (short) 300, (short) -50, (short) 50), 8));
        assertEquals(2, out.length);
        assertEquals(200, out[0]);
        assertEquals(0, out[1]);
    }

    @Test
    public void fortyEightKhzBecomesSixteenAcrossBuffers() {
        AudioDecoder.PcmResampler resampler = new AudioDecoder.PcmResampler(48000, 1);
        int total = 0;
        for (int buffer = 0; buffer < 10; buffer++) {
            short[] chunk = new short[4800]; // 100 ms
            for (int i = 0; i < chunk.length; i++) chunk[i] = (short) (i % 100);
            byte[] in = pcm(chunk);
            total += resampler.process(in, in.length).length / 2;
        }
        // 1 s at 48 kHz -> 16000 samples (+/- one at the boundaries)
        assertEquals(16000, total, 1);
    }
}
