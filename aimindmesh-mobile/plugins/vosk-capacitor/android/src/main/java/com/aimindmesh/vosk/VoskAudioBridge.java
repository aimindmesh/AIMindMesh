package com.aimindmesh.vosk;

/**
 * Entry point for audio captured outside this plugin (e.g. by the app's recording service).
 *
 * When live recognition runs in "external audio" mode, the recognizer registers itself here
 * and the recorder pushes every captured buffer through {@link #feed}. Recognizer and saved file
 * then share one capture and one sample clock, so result timestamps match the recording.
 */
public final class VoskAudioBridge {

    public interface Sink {
        /**
         * @param samples      PCM 16-bit mono 16 kHz
         * @param length       number of valid samples in {@code samples}
         * @param sampleOffset index of {@code samples[0]} in the recording, in samples
         */
        void onAudio(short[] samples, int length, long sampleOffset);
    }

    private static volatile Sink sink;

    private VoskAudioBridge() {
    }

    static void setSink(Sink newSink) {
        sink = newSink;
    }

    static void clearSink(Sink expected) {
        if (sink == expected) {
            sink = null;
        }
    }

    /** True when a recognizer is waiting for external audio. */
    public static boolean isActive() {
        return sink != null;
    }

    /** Forwards audio to the active recognizer; a no-op when none is registered. */
    public static void feed(short[] samples, int length, long sampleOffset) {
        Sink current = sink;
        if (current != null) {
            current.onAudio(samples, length, sampleOffset);
        }
    }
}
