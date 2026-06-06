package com.aimindmesh.vad;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;

/**
 * Capacitor plugin for Voice Activity Detection using Silero VAD with ONNX
 * Runtime.
 */
@CapacitorPlugin(name = "VAD")
public class VADPlugin extends Plugin {
    private static final String TAG = "VADPlugin";

    private SileroVAD vadModel;
    private boolean isModelLoaded = false;

    @Override
    public void load() {
        super.load();
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

            Log.i(TAG, "Loading VAD model: " + modelFile.getAbsolutePath());

            // Initialize VAD model
            if (vadModel != null) {
                vadModel.release();
            }

            vadModel = new SileroVAD(getContext());
            boolean success = vadModel.loadModel(modelFile.getAbsolutePath());

            if (success) {
                isModelLoaded = true;
                Log.i(TAG, "VAD model loaded successfully");
                call.resolve();
            } else {
                call.reject("Failed to load VAD model");
            }

        } catch (Exception e) {
            Log.e(TAG, "Error loading model", e);
            call.reject("Failed to load model: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        try {
            if (vadModel != null) {
                vadModel.release();
                vadModel = null;
            }
            isModelLoaded = false;
            Log.i(TAG, "VAD model unloaded");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error unloading model", e);
            call.reject("Failed to unload model: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", isModelLoaded && vadModel != null);
        call.resolve(result);
    }

    @PluginMethod
    public void setThresholds(PluginCall call) {
        if (vadModel == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        Float speechThreshold = call.getFloat("speechThreshold");
        Integer silenceDurationMs = call.getInt("silenceDurationMs");
        Integer minSpeechDurationMs = call.getInt("minSpeechDurationMs");

        if (speechThreshold != null) {
            vadModel.setSpeechThreshold(speechThreshold);
        }
        if (silenceDurationMs != null) {
            vadModel.setSilenceDurationMs(silenceDurationMs);
        }
        if (minSpeechDurationMs != null) {
            vadModel.setMinSpeechDurationMs(minSpeechDurationMs);
        }

        call.resolve();
    }

    @PluginMethod
    public void processSamples(PluginCall call) {
        if (!isModelLoaded || vadModel == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String samplesBase64 = call.getString("samples");

        if (samplesBase64 == null || samplesBase64.isEmpty()) {
            call.reject("Samples data is required (Base64 encoded float32 array)");
            return;
        }

        try {
            // Decode Base64 to byte array
            byte[] samplesBytes = Base64.decode(samplesBase64, Base64.DEFAULT);

            // Convert bytes to float array (assuming Float32 encoding)
            float[] samples = new float[samplesBytes.length / 4];
            ByteBuffer.wrap(samplesBytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(samples);

            // Process samples
            SileroVAD.VADResult result = vadModel.processSamples(samples);

            // Build response
            JSObject response = new JSObject();
            response.put("isSpeech", result.isSpeech);
            response.put("confidence", result.confidence);

            if (result.speechStartMs != null) {
                response.put("speechStartMs", result.speechStartMs);
            }
            if (result.speechEndMs != null) {
                response.put("speechEndMs", result.speechEndMs);
            }

            call.resolve(response);

        } catch (Exception e) {
            Log.e(TAG, "Error processing samples", e);
            call.reject("Failed to process samples: " + e.getMessage());
        }
    }

    @PluginMethod
    public void processFile(PluginCall call) {
        if (!isModelLoaded || vadModel == null) {
            call.reject("Model not loaded. Call loadModel first.");
            return;
        }

        String audioPath = call.getString("audioPath");

        if (audioPath == null || audioPath.isEmpty()) {
            call.reject("Audio path is required");
            return;
        }

        // Run on background thread
        new Thread(() -> {
            try {
                // Resolve path
                File filesDir = getContext().getFilesDir();
                File audioFile = new File(
                        audioPath.startsWith("/") ? audioPath : new File(filesDir, audioPath).getAbsolutePath());

                if (!audioFile.exists()) {
                    call.reject("Audio file not found: " + audioFile.getAbsolutePath());
                    return;
                }

                Log.i(TAG, "Processing file for VAD: " + audioFile.getAbsolutePath());

                // Process file and get speech segments
                List<SileroVAD.SpeechSegment> segments = vadModel.processFile(audioFile.getAbsolutePath());

                // Build response
                JSArray segmentsArray = new JSArray();
                for (SileroVAD.SpeechSegment seg : segments) {
                    JSObject segObj = new JSObject();
                    segObj.put("startMs", seg.startMs);
                    segObj.put("endMs", seg.endMs);
                    segObj.put("durationMs", seg.endMs - seg.startMs);
                    segmentsArray.put(segObj);
                }

                JSObject response = new JSObject();
                response.put("segments", segmentsArray);
                call.resolve(response);

            } catch (Exception e) {
                Log.e(TAG, "Error processing file", e);
                call.reject("Failed to process file: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void reset(PluginCall call) {
        if (vadModel != null) {
            vadModel.reset();
        }
        call.resolve();
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

    @Override
    protected void handleOnDestroy() {
        if (vadModel != null) {
            vadModel.release();
            vadModel = null;
        }
        isModelLoaded = false;
        super.handleOnDestroy();
    }
}
