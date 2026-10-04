package com.aimindmesh.mobile.recording;

import android.util.Log;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Other consumers of the meeting recording's audio besides live Vosk (which has its own
 * VoskAudioBridge in its plugin), e.g. Voxtral live transcription. They get the same samples and
 * sample clock as the saved file, from the recorder's consumer thread: a tap must return quickly
 * (copy and queue), or live results fall behind (the recording itself never waits on taps).
 */
public final class RecordingAudioTaps {
    private static final String TAG = "RecordingAudioTaps";

    public interface Tap {
        /**
         * @param samples      PCM 16-bit mono 16 kHz, valid only during the call
         * @param length       number of valid samples
         * @param sampleOffset index of samples[0] in the recording
         */
        void onAudio(short[] samples, int length, long sampleOffset);
    }

    private static final CopyOnWriteArrayList<Tap> taps = new CopyOnWriteArrayList<>();

    private RecordingAudioTaps() {
    }

    public static void add(Tap tap) {
        taps.addIfAbsent(tap);
    }

    public static void remove(Tap tap) {
        taps.remove(tap);
    }

    public static boolean isEmpty() {
        return taps.isEmpty();
    }

    static void feed(short[] samples, int length, long sampleOffset) {
        for (Tap tap : taps) {
            try {
                tap.onAudio(samples, length, sampleOffset);
            } catch (Exception e) {
                Log.w(TAG, "Audio tap failed on a chunk", e);
            }
        }
    }
}
