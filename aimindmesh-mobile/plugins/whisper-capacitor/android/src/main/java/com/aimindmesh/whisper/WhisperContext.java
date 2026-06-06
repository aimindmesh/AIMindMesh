package com.aimindmesh.whisper;

import android.content.Context;
import android.util.Log;

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

    // Static block to load native library
    static {
        try {
            System.loadLibrary("whisper");
            System.loadLibrary("whisper-capacitor");
            Log.i(TAG, "Whisper native library loaded");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load whisper native library. " +
                    "Make sure libwhisper.so and libwhisper-capacitor.so are in android/libs/<abi>/", e);
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
        if (isLoaded) {
            release();
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

    /**
     * Transcribe an audio file
     * 
     * @param audioPath Path to WAV file (16kHz mono PCM)
     * @param language  Language code or "auto"
     * @param translate If true, translate to English
     * @return TranscriptResult with text and segments
     */
    public TranscriptResult transcribe(String audioPath, String language, boolean translate) {
        if (!isLoaded || contextPtr == 0) {
            throw new IllegalStateException("Model not loaded");
        }

        String resultJson = nativeTranscribeFile(contextPtr, audioPath, language, translate);
        return parseResult(resultJson);
    }

    /**
     * Transcribe raw audio samples
     * 
     * @param samples  Float array of audio samples (16kHz mono, normalized -1 to 1)
     * @param language Language code or "auto"
     * @return TranscriptResult with text and segments
     */
    public TranscriptResult transcribeAudio(float[] samples, String language) {
        if (!isLoaded || contextPtr == 0) {
            throw new IllegalStateException("Model not loaded");
        }

        String resultJson = nativeTranscribeAudio(contextPtr, samples, language);
        return parseResult(resultJson);
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
        if (!isLoaded || contextPtr == 0) {
            throw new IllegalStateException("Model not loaded");
        }

        // Call optimized native method with all parameters
        String resultJson = nativeTranscribeAudioOptimized(
                contextPtr,
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
                wordTimestamps);
        return parseResult(resultJson);
    }

    /**
     * Release resources
     */
    public void release() {
        if (contextPtr != 0) {
            nativeRelease(contextPtr);
            contextPtr = 0;
        }
        isLoaded = false;
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
            // Simple JSON parsing (avoid bringing in a JSON library)
            // Expected format:
            // {"text":"...","segments":[{"text":"...","start":0,"end":100},...]}

            // Extract text
            int textStart = json.indexOf("\"text\":\"") + 8;
            int textEnd = json.indexOf("\"", textStart);
            if (textStart > 7 && textEnd > textStart) {
                result.text = json.substring(textStart, textEnd)
                        .replace("\\n", "\n")
                        .replace("\\\"", "\"");
            } else {
                result.text = "";
            }

            // Extract segments
            int segmentsStart = json.indexOf("\"segments\":[");
            if (segmentsStart > 0) {
                int segmentsEnd = json.indexOf("]", segmentsStart);
                String segmentsStr = json.substring(segmentsStart + 12, segmentsEnd);

                // Parse each segment
                int pos = 0;
                while (pos < segmentsStr.length()) {
                    int segStart = segmentsStr.indexOf("{", pos);
                    int segEnd = segmentsStr.indexOf("}", segStart);
                    if (segStart < 0 || segEnd < 0)
                        break;

                    String segStr = segmentsStr.substring(segStart, segEnd + 1);
                    Segment seg = new Segment();

                    // Parse segment text
                    int stextStart = segStr.indexOf("\"text\":\"") + 8;
                    int stextEnd = segStr.indexOf("\"", stextStart);
                    if (stextStart > 7 && stextEnd > stextStart) {
                        seg.text = segStr.substring(stextStart, stextEnd);
                    }

                    // Parse start time
                    int startStart = segStr.indexOf("\"start\":") + 8;
                    int startEnd = segStr.indexOf(",", startStart);
                    if (startEnd < 0)
                        startEnd = segStr.indexOf("}", startStart);
                    if (startStart > 7 && startEnd > startStart) {
                        seg.startMs = (long) Double.parseDouble(segStr.substring(startStart, startEnd).trim());
                    }

                    // Parse end time
                    int endStart = segStr.indexOf("\"end\":") + 6;
                    int endEnd = segStr.indexOf(",", endStart);
                    if (endEnd < 0)
                        endEnd = segStr.indexOf("}", endStart);
                    if (endStart > 5 && endEnd > endStart) {
                        seg.endMs = (long) Double.parseDouble(segStr.substring(endStart, endEnd).trim());
                    }

                    result.segments.add(seg);
                    pos = segEnd + 1;
                }
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to parse result JSON", e);
            result.text = json; // Fallback: use raw response as text
        }

        return result;
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
            boolean wordTimestamps);

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
        if (!isLoaded || contextPtr == 0) {
            throw new IllegalStateException("Model not loaded");
        }

        String resultJson = nativeTranscribeAudioStreaming(
                contextPtr,
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
        return parseResult(resultJson);
    }

    /**
     * Transcription result
     */
    public static class TranscriptResult {
        public String text = "";
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
