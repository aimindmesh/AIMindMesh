package com.aimindmesh.whisper;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class WhisperRangeReadTest {

    /** A 16 kHz mono WAV whose sample i has value i, optionally with a LIST chunk before data. */
    private static File wav(int samples, boolean extraChunk, int declaredDataBytes) throws IOException {
        File f = File.createTempFile("range", ".wav");
        f.deleteOnExit();
        ByteBuffer bb = ByteBuffer.allocate(64 + samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        bb.put("RIFF".getBytes()).putInt(0).put("WAVE".getBytes());
        bb.put("fmt ".getBytes()).putInt(16).putShort((short) 1).putShort((short) 1)
                .putInt(16000).putInt(32000).putShort((short) 2).putShort((short) 16);
        if (extraChunk) {
            bb.put("LIST".getBytes()).putInt(4).put("INFO".getBytes());
        }
        bb.put("data".getBytes()).putInt(declaredDataBytes);
        for (int i = 0; i < samples; i++) bb.putShort((short) i);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bb.array(), 0, bb.position());
        }
        return f;
    }

    @Test
    public void readsOnlyTheRequestedRange() throws IOException {
        File f = wav(16000, false, 32000);
        float[] s = WhisperContext.readWavRange(f.getPath(), 500, 600);
        assertEquals(1600, s.length);
        assertEquals(8000 / 32768f, s[0], 1e-6);
    }

    @Test
    public void findsTheDataAfterOtherChunks() throws IOException {
        File f = wav(1600, true, 3200);
        float[] s = WhisperContext.readWavRange(f.getPath(), 0, 10);
        assertEquals(160, s.length);
        assertEquals(0f, s[0], 0f);
        assertEquals(1 / 32768f, s[1], 1e-9);
    }

    @Test
    public void aFileStillBeingWrittenIsReadUpToItsLength() throws IOException {
        // The header of a recording in progress still says 0 bytes of data
        File f = wav(3200, false, 0);
        assertEquals(3200, WhisperContext.readWavRange(f.getPath(), 0, 60_000).length);
        assertEquals(0, WhisperContext.readWavRange(f.getPath(), 5000, 6000).length);
    }
}
