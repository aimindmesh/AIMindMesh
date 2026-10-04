package com.aimindmesh.whisper;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Whisper Context wrapper for whisper.cpp JNI bindings.
 * 
 * This class provides a Java interface to the native whisper.cpp library.
 * The native library must be compiled and placed in:
 * android/libs/arm64-v8a/libwhisper.so
 * android/libs/armeabi-v7a/libwhisper.so
 * 
 * Building whisper.cpp for Android:
 * git clone https://github.com/ggerganov/whisper.cpp
 * cd whisper.cpp
 * mkdir build-android && cd build-android
 * cmake ..
 * -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
 * -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24
 * make -j$(nproc)
 * 
 * Alternative: Use pre-built JNI bindings from whisper-android project
 * https://github.com/nicksay/whisper-android
 */
public class WhisperContext {
    private static final String TAG = "WhisperContext";

    private long contextPtr = 0;
    private Context appContext;
    private boolean isLoaded = false;

    // whisper_full is neither reentrant on one context nor safe against whisper_free: calls
    // run one at a time (callers wait), and a release() that arrives mid-inference is deferred
    // until that inference returns instead of freeing the context under it.
    private final Object lock = new Object();
    private boolean busy = false;
    private boolean releasePending = false;

    /** False when the CPU lacks the ARMv8.2 features the library is compiled for, or loading failed. */
    private static final boolean nativeAvailable;

    // Static block to load native library
    static {
        boolean loaded = false;
        if (!cpuSupportsArmV82()) {
            Log.e(TAG, "This CPU lacks ARMv8.2 dotprod/fp16: Whisper is not available on this device");
        } else {
            try {
                // whisper and ggml are linked statically into this library (no libwhisper.so)
                System.loadLibrary("whisper-capacitor");
                Log.i(TAG, "Whisper native library loaded");
                loaded = true;
            } catch (UnsatisfiedLinkError e) {
                Log.e(TAG, "Failed to load whisper native library. " +
                        "Make sure libwhisper-capacitor.so is packaged for this ABI", e);
            }
        }
        nativeAvailable = loaded;
    }

    /** whisper.cpp is built for armv8.2-a+dotprod+fp16; running it elsewhere would crash with SIGILL. */
    private static boolean cpuSupportsArmV82() {
        try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader("/proc/cpuinfo"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("Features")) {
                    return line.contains(" asimddp") && line.contains(" fphp") && line.contains(" asimdhp");
                }
            }
        } catch (java.io.IOException e) {
            Log.w(TAG, "Cannot read /proc/cpuinfo", e);
        }
        return false;
    }

    public static boolean isNativeAvailable() {
        return nativeAvailable;
    }

    /** Asks a running transcription to stop as soon as possible (it then returns no text). */
    public static void abort() {
        if (nativeAvailable) {
            nativeAbort();
        }
    }

    public WhisperContext(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /**
     * Load a Whisper model from file
     * 
     * @param modelPath Absolute path to the GGML model file
     * @return true if successful
     */
    public boolean loadModel(String modelPath) {
        if (!nativeAvailable) {
            return false;
        }
        synchronized (lock) {
            if (busy || releasePending) {
                // Each load uses a fresh WhisperContext; reusing one mid-inference is a bug
                throw new IllegalStateException("Context is busy");
            }
            if (isLoaded) {
                freeLocked();
            }

            try {
                contextPtr = nativeLoadModel(modelPath);
                isLoaded = contextPtr != 0;
                return isLoaded;
            } catch (Exception e) {
                Log.e(TAG, "Failed to load model", e);
                return false;
            }
        }
    }

    /** Waits for exclusive use of the context; throws if it is (being) released. */
    private long beginCall() {
        synchronized (lock) {
            while (busy && !releasePending) {
                try {
                    lock.wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while waiting for Whisper", e);
                }
            }
            if (!isLoaded || contextPtr == 0 || releasePending) {
                throw new IllegalStateException("Model not loaded");
            }
            busy = true;
            return contextPtr;
        }
    }

    private void endCall() {
        synchronized (lock) {
            busy = false;
            if (releasePending) {
                freeLocked();
            }
            lock.notifyAll();
        }
    }

    private void freeLocked() {
        if (contextPtr != 0) {
            nativeRelease(contextPtr);
            contextPtr = 0;
        }
        isLoaded = false;
        releasePending = false;
    }

    /**
     * Transcribe an audio file
     * 
     * @param audioPath Path to WAV file (16kHz mono PCM)
     * @param language  Language code or "auto"
     * @param translate If true, translate to English
     * @return TranscriptResult with text and segments
     */
    public TranscriptResult transcribe(String audioPath, String language, boolean translate) {
        long ctx = beginCall();
        try {
            return parseResult(nativeTranscribeFile(ctx, audioPath, language, translate));
        } finally {
            endCall();
        }
    }

    /**
     * Transcribe raw audio samples
     * 
     * @param samples  Float array of audio samples (16kHz mono, normalized -1 to 1)
     * @param language Language code or "auto"
     * @return TranscriptResult with text and segments
     */
    public TranscriptResult transcribeAudio(float[] samples, String language) {
        long ctx = beginCall();
        try {
            return parseResult(nativeTranscribeAudio(ctx, samples, language));
        } finally {
            endCall();
        }
    }

    /**
     * Transcribe raw audio samples with optimized parameters for Italian
     * 
     * @param samples                 Float array of audio samples (16kHz mono,
     *                                normalized -1 to 1)
     * @param language                Language code ("it", "en", or "auto")
     * @param temperature             Temperature for sampling (0.0 = deterministic)
     * @param beamSize                Beam size for beam search (5 = standard)
     * @param bestOf                  Number of candidates to evaluate
     * @param initialPrompt           Context prompt to reduce language mixing
     * @param vadFilter               Enable voice activity detection
     * @param minSilenceDurationMs    Minimum silence duration for splitting
     * @param speechPadMs             Padding around speech segments
     * @param conditionOnPreviousText Use previous context for coherence
     * @param wordTimestamps          Enable word-level timestamps
     * @return TranscriptResult with text and segments
     */
    public TranscriptResult transcribeAudioOptimized(
            float[] samples,
            String language,
            int nThreads,
            float temperature,
            int beamSize,
            int bestOf,
            String initialPrompt,
            boolean vadFilter,
            int minSilenceDurationMs,
            int speechPadMs,
            boolean conditionOnPreviousText,
            boolean wordTimestamps) {
        return transcribeAudioOptimized(samples, language, nThreads, temperature, beamSize, bestOf,
                initialPrompt, vadFilter, minSilenceDurationMs, speechPadMs, conditionOnPreviousText,
                wordTimestamps, 0);
    }

    /** As above, with the encoder window in frames (1500 = 30 s; 0 = full window). */
    public TranscriptResult transcribeAudioOptimized(
            float[] samples,
            String language,
            int nThreads,
            float temperature,
            int beamSize,
            int bestOf,
            String initialPrompt,
            boolean vadFilter,
            int minSilenceDurationMs,
            int speechPadMs,
            boolean conditionOnPreviousText,
            boolean wordTimestamps,
            int audioCtx) {
        long ctx = beginCall();
        String resultJson;
        try {
            // Call optimized native method with all parameters
            resultJson = nativeTranscribeAudioOptimized(
                ctx,
                samples,
                language,
                nThreads,
                temperature,
                beamSize,
                bestOf,
                initialPrompt,
                vadFilter,
                minSilenceDurationMs,
                speechPadMs,
                conditionOnPreviousText,
                wordTimestamps,
                audioCtx);
        } finally {
            endCall();
        }
        return parseResult(resultJson);
    }

    /**
     * Release resources
     */
    public void release() {
        synchronized (lock) {
            if (busy) {
                // Freed by endCall() once the running inference returns; queued callers bail out
                releasePending = true;
                lock.notifyAll();
                return;
            }
            freeLocked();
        }
    }

    /**
     * Parse JSON result from native call
     */
    private TranscriptResult parseResult(String json) {
        TranscriptResult result = new TranscriptResult();
        result.segments = new ArrayList<>();

        if (json == null || json.isEmpty()) {
            result.text = "";
            return result;
        }

        try {
            // Expected format:
            // {"text":"...","segments":[{"text":"...","start":0,"end":100},...]}
            // org.json (part of Android) handles escaped quotes/brackets that the old
            // indexOf-based parser cut the transcript at.
            JSONObject root = new JSONObject(json);
            result.text = root.optString("text", "");
            result.language = root.optString("language", "");

            JSONArray segments = root.optJSONArray("segments");
            if (segments != null) {
                for (int i = 0; i < segments.length(); i++) {
                    JSONObject segObj = segments.optJSONObject(i);
                    if (segObj == null) continue;
                    Segment seg = new Segment();
                    seg.text = segObj.optString("text", "");
                    seg.startMs = segObj.optLong("start", 0);
                    seg.endMs = segObj.optLong("end", 0);
                    result.segments.add(seg);
                }
            }
        } catch (Exception e) {
            // Never surface raw JSON as transcript text
            Log.e(TAG, "Failed to parse result JSON", e);
            result.text = "";
            result.segments.clear();
        }

        return result;
    }

    /**
     * Transcribes [startMs, endMs) of a 16 kHz mono PCM16 WAV file, reading only that range.
     * Segment times are returned relative to the start of the file.
     */
    public TranscriptResult transcribeFileRange(
            String wavPath,
            long startMs,
            long endMs,
            String language,
            int nThreads,
            int beamSize,
            String initialPrompt,
            int audioCtx) throws java.io.IOException {
        float[] samples = readWavRange(wavPath, startMs, endMs);
        TranscriptResult result = transcribeAudioOptimized(samples, language, nThreads, 0.0f, beamSize, 1,
                initialPrompt == null ? "" : initialPrompt, false, 0, 0, false, false, audioCtx);
        for (Segment seg : result.segments) {
            seg.startMs += startMs;
            seg.endMs += startMs;
        }
        return result;
    }

    private static final int SAMPLE_RATE = 16000;

    /**
     * Reads [startMs, endMs) of a 16 kHz mono PCM16 WAV as floats. The file may still be growing
     * (a recording in progress): only the samples written so far are read.
     */
    static float[] readWavRange(String wavPath, long startMs, long endMs) throws java.io.IOException {
        try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(wavPath, "r")) {
            long dataOffset = findDataOffset(raf);
            long totalSamples = Math.max(0, (raf.length() - dataOffset) / 2);
            long from = Math.min(totalSamples, Math.max(0, startMs * SAMPLE_RATE / 1000));
            long to = Math.min(totalSamples, Math.max(from, endMs * SAMPLE_RATE / 1000));
            int n = (int) (to - from);
            byte[] bytes = new byte[n * 2];
            raf.seek(dataOffset + from * 2);
            raf.readFully(bytes);
            float[] samples = new float[n];
            for (int i = 0; i < n; i++) {
                short v = (short) ((bytes[2 * i] & 0xff) | (bytes[2 * i + 1] << 8));
                samples[i] = v / 32768.0f;
            }
            return samples;
        }
    }

    /** Offset of the PCM data: after the "data" chunk header, or 44 for a canonical header. */
    static long findDataOffset(java.io.RandomAccessFile raf) throws java.io.IOException {
        if (raf.length() < 44) return 44;
        byte[] id = new byte[4];
        long pos = 12; // after "RIFF" <size> "WAVE"
        while (pos + 8 <= raf.length() && pos < 4096) {
            raf.seek(pos);
            raf.readFully(id);
            int size = Integer.reverseBytes(raf.readInt());
            if (id[0] == 'd' && id[1] == 'a' && id[2] == 't' && id[3] == 'a') {
                return pos + 8;
            }
            pos += 8 + Math.max(0, size) + (size & 1);
        }
        return 44;
    }

    // Native methods - to be implemented in JNI
    private static native long nativeLoadModel(String modelPath);

    private static native String nativeTranscribeFile(long ctx, String audioPath, String language, boolean translate);

    private static native String nativeTranscribeAudio(long ctx, float[] samples, String language);

    private static native String nativeTranscribeAudioOptimized(
            long ctx,
            float[] samples,
            String language,
            int nThreads,
            float temperature,
            int beamSize,
            int bestOf,
            String initialPrompt,
            boolean vadFilter,
            int minSilenceDurationMs,
            int speechPadMs,
            boolean conditionOnPreviousText,
            boolean wordTimestamps,
            int audioCtx);

    /**
     * Native method for streaming transcription with real-time segment callback.
     * Each segment is reported to the callback as soon as it's transcribed.
     */
    private static native String nativeTranscribeAudioStreaming(
            long ctx,
            float[] samples,
            String language,
            int nThreads,
            float temperature,
            int beamSize,
            int bestOf,
            String initialPrompt,
            boolean vadFilter,
            boolean conditionOnPreviousText,
            SegmentCallback callback);

    private static native void nativeRelease(long ctx);

    private static native void nativeAbort();

    /**
     * Callback interface for receiving transcription segments in real-time.
     */
    public interface SegmentCallback {
        /**
         * Called when a new segment is transcribed.
         * 
         * @param text         The transcribed text of the segment
         * @param startMs      Start time in milliseconds
         * @param endMs        End time in milliseconds
         * @param segmentIndex Index of this segment (0-based)
         */
        void onSegment(String text, long startMs, long endMs, int segmentIndex);
    }

    /**
     * Transcribe audio with streaming callback for real-time segment updates.
     * 
     * @param samples                 Float array of audio samples (16kHz mono)
     * @param language                Language code
     * @param nThreads                Number of threads
     * @param temperature             Temperature for sampling
     * @param beamSize                Beam size for search
     * @param bestOf                  Number of candidates
     * @param initialPrompt           Context prompt
     * @param vadFilter               Enable VAD filter
     * @param conditionOnPreviousText Use previous context
     * @param callback                Callback for real-time segment updates
     * @return Final transcription result
     */
    public TranscriptResult transcribeAudioStreaming(
            float[] samples,
            String language,
            int nThreads,
            float temperature,
            int beamSize,
            int bestOf,
            String initialPrompt,
            boolean vadFilter,
            boolean conditionOnPreviousText,
            SegmentCallback callback) {
        long ctx = beginCall();
        String resultJson;
        try {
            resultJson = nativeTranscribeAudioStreaming(
                ctx,
                samples,
                language,
                nThreads,
                temperature,
                beamSize,
                bestOf,
                initialPrompt,
                vadFilter,
                conditionOnPreviousText,
                callback);
        } finally {
            endCall();
        }
        return parseResult(resultJson);
    }

    /**
     * Transcription result
     */
    public static class TranscriptResult {
        public String text = "";
        /** Language whisper detected or was given, e.g. "it" */
        public String language = "";
        public List<Segment> segments = new ArrayList<>();
    }

    /**
     * Transcript segment with timing
     */
    public static class Segment {
        public String text = "";
        public long startMs = 0;
        public long endMs = 0;
    }
}
