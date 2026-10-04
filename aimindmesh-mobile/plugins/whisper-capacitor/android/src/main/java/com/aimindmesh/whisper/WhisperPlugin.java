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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor plugin for whisper.cpp speech recognition (built from plugins/whisper-capacitor/cpp).
 */
@CapacitorPlugin(name = "Whisper")
public class WhisperPlugin extends Plugin {
    private static final String TAG = "WhisperPlugin";

    private volatile WhisperContext whisperContext;
    private volatile boolean isModelLoaded = false;
    // Loads take seconds: running them on Capacitor's single plugin thread stalled every other
    // plugin call. One executor also keeps load/unload ordered as JS issued them.
    private final ExecutorService modelExecutor = Executors.newSingleThreadExecutor();
    // Range transcriptions (meeting post-processing) run one at a time, in the order requested
    private final ExecutorService rangeExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelPath = call.getString("modelPath");

        if (modelPath == null || modelPath.isEmpty()) {
            call.reject("Model path is required");
            return;
        }
        if (!WhisperContext.isNativeAvailable()) {
            call.reject("Whisper is not supported on this device (requires an ARMv8.2 CPU)", "UNSUPPORTED");
            return;
        }

        modelExecutor.execute(() -> {
            try {
                // Resolve path relative to app's files directory
                File filesDir = getContext().getFilesDir();
                File modelFile = new File(filesDir, modelPath);
                if (!modelFile.exists()) {
                    modelFile = new File(modelPath);
                }

                File binaryFile = WhisperFileUtils.resolveModelBinaryPath(modelFile);
                if (binaryFile == null || !binaryFile.exists()) {
                    call.reject("Model file or binary not found: " + modelFile.getAbsolutePath());
                    return;
                }

                Log.i(TAG, "Loading Whisper model binary: " + binaryFile.getAbsolutePath());

                // Release (deferred until any running transcription returns) before loading
                WhisperContext previous = whisperContext;
                whisperContext = null;
                isModelLoaded = false;
                if (previous != null) {
                    previous.release();
                }

                WhisperContext context = new WhisperContext(getContext());
                boolean success = context.loadModel(binaryFile.getAbsolutePath());

                if (success) {
                    whisperContext = context;
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
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        modelExecutor.execute(() -> {
            try {
                WhisperContext previous = whisperContext;
                whisperContext = null;
                isModelLoaded = false;
                if (previous != null) {
                    previous.release();
                }
                Log.i(TAG, "Whisper model unloaded");
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Error unloading model", e);
                call.reject("Failed to unload model: " + e.getMessage());
            }
        });
    }

    /** Transcribes [startMs, endMs) of a 16 kHz mono WAV file (see WhisperRangeCall). */
    @PluginMethod
    public void transcribeRange(PluginCall call) {
        WhisperRangeCall.run(call, isModelLoaded ? whisperContext : null, rangeExecutor);
    }

    /** Stops the running transcription as soon as possible. */
    @PluginMethod
    public void abort(PluginCall call) {
        WhisperContext.abort();
        call.resolve();
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", isModelLoaded && whisperContext != null);
        call.resolve(result);
    }

    @PluginMethod
    public void transcribe(PluginCall call) {
        // Captured once: the field can be swapped by a concurrent load/unload
        final WhisperContext context = whisperContext;
        if (!isModelLoaded || context == null) {
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
                WhisperContext.TranscriptResult result = context.transcribe(
                        audioFile.getAbsolutePath(),
                        language,
                        translate);

                long processingTime = System.currentTimeMillis() - startTime;

                // Build response
                JSObject response = new JSObject();
                response.put("text", result.text);
                response.put("processingTimeMs", processingTime);

                response.put("segments", segmentsToJson(result));

                call.resolve(response);

            } catch (Exception e) {
                Log.e(TAG, "Transcription failed", e);
                call.reject("Transcription failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void transcribeAudio(PluginCall call) {
        final WhisperContext context = whisperContext;
        if (!isModelLoaded || context == null) {
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
                WhisperContext.TranscriptResult result = context.transcribeAudioOptimized(
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

                response.put("segments", segmentsToJson(result));

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
            result.put("hasNpu", optimizer.hasNpu());
            result.put("npuArch", optimizer.getNpuArch());
            result.put("recommendedBackend", optimizer.getRecommendedBackend());
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
        final WhisperContext context = whisperContext;
        if (!isModelLoaded || context == null) {
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

                    Log.d(TAG, "Segment " + segmentIndex + ": " + text.length() + " chars");
                };

                // Perform streaming transcription
                WhisperContext.TranscriptResult result = context.transcribeAudioStreaming(
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

                response.put("segments", segmentsToJson(result));
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
            File filesDir = getContext().getFilesDir();
            boolean isZip = fileName.toLowerCase().endsWith(".zip") || sourcePath.toLowerCase().endsWith(".zip");

            if (isZip) {
                String folderName = fileName;
                if (folderName.toLowerCase().endsWith(".zip")) {
                    folderName = folderName.substring(0, folderName.length() - 4);
                }
                File targetDir = new File(filesDir, folderName);
                if (targetDir.exists()) {
                    WhisperFileUtils.deleteRecursively(targetDir);
                }
                targetDir.mkdirs();

                java.io.InputStream is = WhisperFileUtils.openInputStream(getContext(), sourcePath);
                if (is == null) {
                    call.reject("Could not open input stream for zip source: " + sourcePath);
                    return;
                }

                boolean extracted = WhisperFileUtils.extractZipStream(is, targetDir);
                if (!extracted) {
                    call.reject("Failed to extract Whisper ZIP bundle to " + targetDir.getAbsolutePath());
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("path", targetDir.getAbsolutePath());
                call.resolve(ret);
                return;
            }

            File destFile = new File(filesDir, fileName);
            if (destFile.getParentFile() != null) {
                destFile.getParentFile().mkdirs();
            }

            java.io.InputStream is = WhisperFileUtils.openInputStream(getContext(), sourcePath);
            if (is == null) {
                call.reject("Could not open input stream from source: " + sourcePath);
                return;
            }

            try (java.io.FileOutputStream fos = new java.io.FileOutputStream(destFile)) {
                byte[] buffer = new byte[64 * 1024];
                int length;
                while ((length = is.read(buffer)) > 0) {
                    fos.write(buffer, 0, length);
                }
            } finally {
                is.close();
            }

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
        final WhisperContext context = whisperContext;
        if (!isModelLoaded || context == null) {
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
                float[] allSamples = WhisperFileUtils.readAudioSamples(audioFile);
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
                    WhisperContext.TranscriptResult result = context.transcribeAudioOptimized(
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
    }

    private static JSArray segmentsToJson(WhisperContext.TranscriptResult result) {
        JSArray segments = new JSArray();
        for (WhisperContext.Segment seg : result.segments) {
            JSObject segObj = new JSObject();
            segObj.put("text", seg.text);
            segObj.put("startMs", seg.startMs);
            segObj.put("endMs", seg.endMs);
            segments.put(segObj);
        }
        return segments;
    }

    @Override
    protected void handleOnDestroy() {
        WhisperContext previous = whisperContext;
        whisperContext = null;
        isModelLoaded = false;
        if (previous != null) {
            // Deferred to the end of a running transcription (a foreground meeting service can
            // keep the process alive after the activity is destroyed)
            previous.release();
        }
        modelExecutor.shutdown();
        super.handleOnDestroy();
    }
}
