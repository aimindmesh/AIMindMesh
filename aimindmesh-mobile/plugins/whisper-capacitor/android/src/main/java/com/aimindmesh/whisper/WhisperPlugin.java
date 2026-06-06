package com.aimindmesh.whisper;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Capacitor plugin for Whisper.cpp speech recognition.
 * 
 * Note: This plugin requires the whisper.cpp native library to be compiled
 * and placed in the libs folder (libwhisper.so for arm64-v8a/armeabi-v7a).
 * 
 * Pre-built libraries can be obtained from:
 * https://github.com/ggerganov/whisper.cpp/releases
 * 
 * Or build from source using Android NDK.
 */
@CapacitorPlugin(name = "Whisper")
public class WhisperPlugin extends Plugin {
    private static final String TAG = "WhisperPlugin";

    private WhisperContext whisperContext;
    private boolean isModelLoaded = false;

    @Override
    public void load() {
        super.load();
        // Native library loading will be done in loadModel to avoid startup crashes
        // if the library is not yet installed
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelPath = call.getString("modelPath");

        if (modelPath == null || modelPath.isEmpty()) {
            call.reject("Model path is required");
            return;
        }

        try {
            // Resolve path relative to app's files directory
            File filesDir = getContext().getFilesDir();
            File modelFile = new File(filesDir, modelPath);

            if (!modelFile.exists()) {
                call.reject("Model file not found: " + modelFile.getAbsolutePath());
                return;
            }

            Log.i(TAG, "Loading Whisper model: " + modelFile.getAbsolutePath());

            // Initialize whisper context
            if (whisperContext != null) {
                whisperContext.release();
            }

            whisperContext = new WhisperContext(getContext());
            boolean success = whisperContext.loadModel(modelFile.getAbsolutePath());

            if (success) {
                isModelLoaded = true;
                Log.i(TAG, "Whisper model loaded successfully");
                call.resolve();
            } else {
                call.reject("Failed to load Whisper model");
            }

        } catch (Exception e) {
            Log.e(TAG, "Error loading model", e);
            call.reject("Failed to load model: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        try {
            if (whisperContext != null) {
                whisperContext.release();
                whisperContext = null;
            }
            isModelLoaded = false;
            Log.i(TAG, "Whisper model unloaded");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error unloading model", e);
            call.reject("Failed to unload model: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", isModelLoaded && whisperContext != null);
        call.resolve(result);
    }

    @PluginMethod
    public void transcribe(PluginCall call) {
        if (!isModelLoaded || whisperContext == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String audioPath = call.getString("audioPath");
        String language = call.getString("language", "auto");
        boolean translate = call.getBoolean("translate", false);

        if (audioPath == null || audioPath.isEmpty()) {
            call.reject("Audio path is required");
            return;
        }

        // Run transcription on background thread
        getActivity().runOnUiThread(() -> {
            new Thread(() -> {
                try {
                    long startTime = System.currentTimeMillis();

                    // Resolve path
                    File filesDir = getContext().getFilesDir();
                    File audioFile = new File(
                            audioPath.startsWith("/") ? audioPath : new File(filesDir, audioPath).getAbsolutePath());

                    if (!audioFile.exists()) {
                        call.reject("Audio file not found: " + audioFile.getAbsolutePath());
                        return;
                    }

                    Log.i(TAG, "Transcribing: " + audioFile.getAbsolutePath());

                    // Perform transcription
                    WhisperContext.TranscriptResult result = whisperContext.transcribe(
                            audioFile.getAbsolutePath(),
                            language,
                            translate);

                    long processingTime = System.currentTimeMillis() - startTime;

                    // Build response
                    JSObject response = new JSObject();
                    response.put("text", result.text);
                    response.put("processingTimeMs", processingTime);

                    // Add segments
                    JSArray segments = new JSArray();
                    for (WhisperContext.Segment seg : result.segments) {
                        JSObject segObj = new JSObject();
                        segObj.put("text", seg.text);
                        segObj.put("startMs", seg.startMs);
                        segObj.put("endMs", seg.endMs);
                        segments.put(segObj);
                    }
                    response.put("segments", segments);

                    call.resolve(response);

                } catch (Exception e) {
                    Log.e(TAG, "Transcription failed", e);
                    call.reject("Transcription failed: " + e.getMessage());
                }
            }).start();
        });
    }

    @PluginMethod
    public void transcribeAudio(PluginCall call) {
        if (!isModelLoaded || whisperContext == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String audioData = call.getString("audioData");
        String language = call.getString("language", "auto");

        // Italian-optimized parameters (handle null from getDouble)
        Double tempDouble = call.getDouble("temperature", 0.0);
        float temperature = tempDouble != null ? tempDouble.floatValue() : 0.0f;
        int beamSize = call.getInt("beamSize", 5);
        int bestOf = call.getInt("bestOf", 1);
        int threads = call.getInt("threads", 4); // Default to 4 threads
        String initialPrompt = call.getString("initialPrompt", "");
        boolean vadFilter = call.getBoolean("vadFilter", false);
        int minSilenceDurationMs = call.getInt("minSilenceDurationMs", 500);
        int speechPadMs = call.getInt("speechPadMs", 400);
        boolean conditionOnPreviousText = call.getBoolean("conditionOnPreviousText", false);
        boolean wordTimestamps = call.getBoolean("wordTimestamps", false);

        if (audioData == null || audioData.isEmpty()) {
            call.reject("Audio data is required (Base64 encoded PCM)");
            return;
        }

        // Run transcription on background thread
        new Thread(() -> {
            try {
                // Decode Base64 to byte array
                byte[] pcmData = Base64.decode(audioData, Base64.DEFAULT);

                // Convert byte array to float array (assuming 16-bit PCM)
                float[] samples = new float[pcmData.length / 2];
                for (int i = 0; i < samples.length; i++) {
                    short sample = (short) ((pcmData[i * 2 + 1] << 8) | (pcmData[i * 2] & 0xFF));
                    samples[i] = sample / 32768.0f;
                }

                Log.i(TAG, "Transcribing audio data: " + samples.length + " samples, language=" + language +
                        ", temperature=" + temperature + ", beamSize=" + beamSize + ", threads=" + threads);

                // Perform transcription with optimized parameters
                WhisperContext.TranscriptResult result = whisperContext.transcribeAudioOptimized(
                        samples,
                        language,
                        threads,
                        temperature,
                        beamSize,
                        bestOf,
                        initialPrompt,
                        vadFilter,
                        minSilenceDurationMs,
                        speechPadMs,
                        conditionOnPreviousText,
                        wordTimestamps);

                // Build response
                JSObject response = new JSObject();
                response.put("text", result.text);

                JSArray segments = new JSArray();
                for (WhisperContext.Segment seg : result.segments) {
                    JSObject segObj = new JSObject();
                    segObj.put("text", seg.text);
                    segObj.put("startMs", seg.startMs);
                    segObj.put("endMs", seg.endMs);
                    segments.put(segObj);
                }
                response.put("segments", segments);

                call.resolve(response);

            } catch (Exception e) {
                Log.e(TAG, "Transcription failed", e);
                call.reject("Transcription failed: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Get device optimization information.
     * Returns SoC type, recommended threads, and recommended model.
     */
    @PluginMethod
    public void getDeviceOptimization(PluginCall call) {
        try {
            WhisperDeviceOptimizer optimizer = new WhisperDeviceOptimizer(getContext());
            WhisperDeviceOptimizer.SoC soc = optimizer.detectSoC();

            JSObject result = new JSObject();
            result.put("soc", soc.name());
            result.put("availableCores", optimizer.getCoreCount());
            result.put("recommendedThreads", optimizer.getRecommendedThreadCount(soc));
            result.put("recommendedModel", optimizer.getRecommendedModel(soc));
            result.put("deviceInfo", optimizer.getDeviceInfoString());

            Log.i(TAG, optimizer.getDeviceInfoString());

            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to get device optimization", e);
            call.reject("Failed to get device optimization: " + e.getMessage());
        }
    }

    /**
     * Transcribe audio with streaming segment callbacks.
     * Each segment is sent to the 'transcriptionSegment' event as soon as it's
     * transcribed.
     */
    @PluginMethod
    public void transcribeAudioStreaming(PluginCall call) {
        if (!isModelLoaded || whisperContext == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String audioData = call.getString("audioData");
        String language = call.getString("language", "auto");

        // Parameters
        Double tempDouble = call.getDouble("temperature", 0.0);
        float temperature = tempDouble != null ? tempDouble.floatValue() : 0.0f;
        int beamSize = call.getInt("beamSize", 1); // Default to greedy for streaming
        int bestOf = call.getInt("bestOf", 1);
        int threads = call.getInt("threads", 4);
        String initialPrompt = call.getString("initialPrompt", "");
        boolean vadFilter = call.getBoolean("vadFilter", false);
        boolean conditionOnPreviousText = call.getBoolean("conditionOnPreviousText", false);

        if (audioData == null || audioData.isEmpty()) {
            call.reject("Audio data is required (Base64 encoded PCM)");
            return;
        }

        // Run transcription on background thread
        new Thread(() -> {
            try {
                // Decode Base64 to byte array
                byte[] pcmData = Base64.decode(audioData, Base64.DEFAULT);

                // Convert byte array to float array (assuming 16-bit PCM)
                float[] samples = new float[pcmData.length / 2];
                for (int i = 0; i < samples.length; i++) {
                    short sample = (short) ((pcmData[i * 2 + 1] << 8) | (pcmData[i * 2] & 0xFF));
                    samples[i] = sample / 32768.0f;
                }

                Log.i(TAG, "Starting streaming transcription: " + samples.length + " samples");

                // Create segment callback that notifies listeners
                WhisperContext.SegmentCallback segmentCallback = (text, startMs, endMs, segmentIndex) -> {
                    JSObject segmentData = new JSObject();
                    segmentData.put("text", text);
                    segmentData.put("startMs", startMs);
                    segmentData.put("endMs", endMs);
                    segmentData.put("segmentIndex", segmentIndex);

                    // Notify TypeScript listeners in real-time
                    notifyListeners("transcriptionSegment", segmentData);

                    Log.d(TAG, "Segment " + segmentIndex + ": " + text);
                };

                // Perform streaming transcription
                WhisperContext.TranscriptResult result = whisperContext.transcribeAudioStreaming(
                        samples,
                        language,
                        threads,
                        temperature,
                        beamSize,
                        bestOf,
                        initialPrompt,
                        vadFilter,
                        conditionOnPreviousText,
                        segmentCallback);

                // Build final response
                JSObject response = new JSObject();
                response.put("text", result.text);

                JSArray segments = new JSArray();
                for (WhisperContext.Segment seg : result.segments) {
                    JSObject segObj = new JSObject();
                    segObj.put("text", seg.text);
                    segObj.put("startMs", seg.startMs);
                    segObj.put("endMs", seg.endMs);
                    segments.put(segObj);
                }
                response.put("segments", segments);
                response.put("complete", true);

                // Notify completion
                notifyListeners("transcriptionComplete", response);

                call.resolve(response);

            } catch (Exception e) {
                Log.e(TAG, "Streaming transcription failed", e);

                JSObject errorData = new JSObject();
                errorData.put("error", e.getMessage());
                notifyListeners("transcriptionError", errorData);

                call.reject("Streaming transcription failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void copyFile(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String fileName = call.getString("fileName");

        if (sourcePath == null || fileName == null) {
            call.reject("sourcePath and fileName are required");
            return;
        }

        try {
            android.net.Uri sourceUri = android.net.Uri.parse(sourcePath);
            File filesDir = getContext().getFilesDir();
            File destFile = new File(filesDir, fileName);

            // Create parent directories if needed
            if (destFile.getParentFile() != null) {
                destFile.getParentFile().mkdirs();
            }

            java.io.InputStream is = getContext().getContentResolver().openInputStream(sourceUri);
            if (is == null) {
                // Try opening as a regular file if not a content URI
                try {
                    is = new java.io.FileInputStream(new File(sourcePath));
                } catch (Exception e) {
                    call.reject("Could not open input stream from source");
                    return;
                }
            }

            java.io.FileOutputStream fos = new java.io.FileOutputStream(destFile);
            byte[] buffer = new byte[8192];
            int length;
            while ((length = is.read(buffer)) > 0) {
                fos.write(buffer, 0, length);
            }

            is.close();
            fos.close();

            JSObject ret = new JSObject();
            ret.put("path", destFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error copying file", e);
            call.reject("Error copying file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void transcribeStream(PluginCall call) {
        if (!isModelLoaded || whisperContext == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String audioPath = call.getString("audioPath");
        String language = call.getString("language", "auto");
        int chunkSizeSeconds = call.getInt("chunkSize", 20); // Default 20s chunks

        if (audioPath == null || audioPath.isEmpty()) {
            call.reject("Audio path is required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            new Thread(() -> {
                try {
                    // 1. Read audio file samples
                    File filesDir = getContext().getFilesDir();
                    File audioFile = new File(
                            audioPath.startsWith("/") ? audioPath : new File(filesDir, audioPath).getAbsolutePath());

                    if (!audioFile.exists()) {
                        call.reject("Audio file not found: " + audioFile.getAbsolutePath());
                        return;
                    }

                    // Decode WAV to samples (simple WAV parser)
                    float[] allSamples = readAudioSamples(audioFile);
                    if (allSamples == null || allSamples.length == 0) {
                        call.reject("Failed to read audio samples or empty file");
                        return;
                    }

                    // 2. Process in chunks
                    int sampleRate = 16000;
                    int samplesPerChunk = chunkSizeSeconds * sampleRate;
                    int totalSamples = allSamples.length;
                    int numChunks = (int) Math.ceil((double) totalSamples / samplesPerChunk);

                    JSArray allResults = new JSArray();

                    Log.i(TAG, "Starting stream transcription: " + totalSamples + " samples, " + numChunks + " chunks");

                    for (int i = 0; i < numChunks; i++) {
                        int startSample = i * samplesPerChunk;
                        int endSample = Math.min(startSample + samplesPerChunk, totalSamples);
                        int chunkLength = endSample - startSample;

                        // Copy chunk samples
                        float[] chunkSamples = new float[chunkLength];
                        System.arraycopy(allSamples, startSample, chunkSamples, 0, chunkLength);

                        // Transcribe chunk using optimized parameters (defaults for now)
                        // Using 'fast' parameters for speed
                        WhisperContext.TranscriptResult result = whisperContext.transcribeAudioOptimized(
                                chunkSamples,
                                language,
                                4, // threads
                                0.0f, // temperature
                                1, // beamSize
                                1, // bestOf
                                "", // initialPrompt
                                false, // vadFilter
                                500, // minSilence
                                400, // speechPad
                                false, // conditionOnPreviousText
                                false // wordTimestamps
                        );

                        // Create chunk result
                        JSObject chunkResult = new JSObject();
                        chunkResult.put("chunkIndex", i);
                        chunkResult.put("text", result.text);

                        // Create segments with time offset
                        JSArray segmentsArr = new JSArray();
                        long timeOffsetMs = (long) i * chunkSizeSeconds * 1000;

                        for (WhisperContext.Segment seg : result.segments) {
                            JSObject segObj = new JSObject();
                            segObj.put("text", seg.text);
                            segObj.put("startMs", seg.startMs + timeOffsetMs);
                            segObj.put("endMs", seg.endMs + timeOffsetMs);
                            segmentsArr.put(segObj);
                        }
                        chunkResult.put("segments", segmentsArr);
                        chunkResult.put("startTimeMs", timeOffsetMs);

                        allResults.put(chunkResult);

                        // Notify listeners
                        notifyListeners("transcriptionChunk", chunkResult);
                    }

                    // Final resolve
                    JSObject finalResult = new JSObject();
                    finalResult.put("complete", true);
                    finalResult.put("chunks", allResults);

                    call.resolve(finalResult);

                } catch (Exception e) {
                    Log.e(TAG, "Streaming failed", e);
                    call.reject("Streaming failed: " + e.getMessage());
                }
            }).start();
        });
    }

    // Helper to read simple WAV file (16-bit PCM, 16kHz)
    private float[] readAudioSamples(File file) throws java.io.IOException {
        java.io.FileInputStream fis = new java.io.FileInputStream(file);
        // Skip header (simple assumption of 44 bytes regular WAV header)
        // In production, a real WAV parser is better, but for this specific use case
        // (audio recorded by app), it's predictable.
        fis.skip(44);

        byte[] buffer = new byte[(int) (file.length() - 44)];
        int read = fis.read(buffer);
        fis.close();

        if (read <= 0)
            return null;

        float[] samples = new float[read / 2];
        for (int i = 0; i < samples.length; i++) {
            short sample = (short) ((buffer[i * 2 + 1] << 8) | (buffer[i * 2] & 0xFF));
            samples[i] = sample / 32768.0f;
        }
        return samples;
    }

    @Override
    protected void handleOnDestroy() {
        if (whisperContext != null) {
            whisperContext.release();
            whisperContext = null;
        }
        isModelLoaded = false;
        super.handleOnDestroy();
    }
}
