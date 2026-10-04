package com.aimindmesh.mobile.recording;

import android.os.SystemClock;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/**
 * Appends PCM16 little-endian samples to a WAV file and keeps its header up to date while
 * recording, so the file stays playable even if the process dies mid-recording.
 */
final class WavFileWriter implements Closeable {
    static final int HEADER_BYTES = 44;
    private static final long HEADER_UPDATE_INTERVAL_MS = 5_000;
    private static final long SYNC_INTERVAL_MS = 10_000;
    private static final long MAX_DATA_BYTES = 0xFFFFFFFFL - 36;

    private final RandomAccessFile raf;
    private final int sampleRate;
    private final int channels;
    private byte[] scratch = new byte[0];
    private long dataBytes;
    private long lastHeaderUpdate;
    private long lastSync;

    WavFileWriter(File file, int sampleRate, int channels) throws IOException {
        this.sampleRate = sampleRate;
        this.channels = channels;
        raf = new RandomAccessFile(file, "rw");
        raf.setLength(0);
        raf.write(header(0, sampleRate, channels));
        lastHeaderUpdate = lastSync = SystemClock.elapsedRealtime();
    }

    void write(short[] samples, int length) throws IOException {
        int byteCount = length * 2;
        if (scratch.length < byteCount) {
            scratch = new byte[byteCount];
        }
        for (int i = 0; i < length; i++) {
            short s = samples[i];
            scratch[2 * i] = (byte) (s & 0xff);
            scratch[2 * i + 1] = (byte) ((s >> 8) & 0xff);
        }
        raf.write(scratch, 0, byteCount);
        dataBytes += byteCount;

        long now = SystemClock.elapsedRealtime();
        if (now - lastHeaderUpdate >= HEADER_UPDATE_INTERVAL_MS) {
            updateHeader();
            lastHeaderUpdate = now;
        }
        if (now - lastSync >= SYNC_INTERVAL_MS) {
            raf.getFD().sync();
            lastSync = now;
        }
    }

    long getDataBytes() {
        return dataBytes;
    }

    private void updateHeader() throws IOException {
        long position = raf.getFilePointer();
        raf.seek(0);
        raf.write(header(dataBytes, sampleRate, channels));
        raf.seek(position);
    }

    @Override
    public void close() throws IOException {
        try {
            updateHeader();
            raf.getFD().sync();
        } finally {
            raf.close();
        }
    }

    /**
     * Rewrites the header of a WAV file left behind by an interrupted recording, using the
     * actual file length. Returns the number of audio data bytes.
     */
    static long repairHeader(File file, int sampleRate, int channels) throws IOException {
        long data = Math.max(0, file.length() - HEADER_BYTES);
        data -= data % (2L * channels);
        try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
            raf.seek(0);
            raf.write(header(data, sampleRate, channels));
        }
        return data;
    }

    static byte[] header(long dataBytes, int sampleRate, int channels) {
        long data = Math.min(dataBytes, MAX_DATA_BYTES);
        long riffSize = data + 36;
        int byteRate = sampleRate * channels * 2;
        int blockAlign = channels * 2;
        byte[] h = new byte[HEADER_BYTES];
        putAscii(h, 0, "RIFF");
        putInt(h, 4, riffSize);
        putAscii(h, 8, "WAVE");
        putAscii(h, 12, "fmt ");
        putInt(h, 16, 16);          // PCM fmt chunk size
        putShort(h, 20, 1);         // PCM format
        putShort(h, 22, channels);
        putInt(h, 24, sampleRate);
        putInt(h, 28, byteRate);
        putShort(h, 32, blockAlign);
        putShort(h, 34, 16);        // bits per sample
        putAscii(h, 36, "data");
        putInt(h, 40, data);
        return h;
    }

    private static void putAscii(byte[] b, int offset, String s) {
        for (int i = 0; i < s.length(); i++) {
            b[offset + i] = (byte) s.charAt(i);
        }
    }

    private static void putInt(byte[] b, int offset, long v) {
        b[offset] = (byte) (v & 0xff);
        b[offset + 1] = (byte) ((v >> 8) & 0xff);
        b[offset + 2] = (byte) ((v >> 16) & 0xff);
        b[offset + 3] = (byte) ((v >> 24) & 0xff);
    }

    private static void putShort(byte[] b, int offset, int v) {
        b[offset] = (byte) (v & 0xff);
        b[offset + 1] = (byte) ((v >> 8) & 0xff);
    }
}
