package com.aimindmesh.speakerembedding;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SpeakerEmbedding")
public class SpeakerEmbeddingPlugin extends Plugin {

    private EcapaEmbedding embedder;

    @Override
    public void load() {
        embedder = new EcapaEmbedding(getContext());
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        String modelPath = call.getString("modelPath");
        if (modelPath == null) {
            call.reject("Model path is required");
            return;
        }

        new Thread(() -> {
            try {
                android.util.Log.i("SpeakerEmbedding", "Loading ONNX model: " + modelPath);
                boolean success = embedder.loadModel(modelPath);
                if (success) {
                    android.util.Log.i("SpeakerEmbedding", "Model loaded successfully");
                    call.resolve();
                } else {
                    android.util.Log.e("SpeakerEmbedding", "Failed to load model");
                    call.reject("Failed to load ONNX model");
                }
            } catch (Exception e) {
                android.util.Log.e("SpeakerEmbedding", "Exception loading model: " + e.getMessage(), e);
                call.reject("Error loading model: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        embedder.unloadModel();
        call.resolve();
    }

    @PluginMethod
    public void isModelLoaded(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", embedder.isModelLoaded());
        call.resolve(ret);
    }

    @PluginMethod
    public void extractEmbedding(PluginCall call) {
        // Get audio data as base64 or array
        String audioBase64 = call.getString("audioData");

        if (audioBase64 == null) {
            call.reject("Audio data is required");
            return;
        }

        new Thread(() -> {
            try {
                // Decode base64 audio data
                byte[] audioBytes = android.util.Base64.decode(audioBase64, android.util.Base64.DEFAULT);

                // Convert to float samples (assuming 16-bit PCM)
                float[] samples = new float[audioBytes.length / 2];
                for (int i = 0; i < samples.length; i++) {
                    int sample = (audioBytes[i * 2 + 1] << 8) | (audioBytes[i * 2] & 0xFF);
                    samples[i] = sample / 32768.0f;
                }

                // Extract embedding
                float[] embedding = embedder.extractEmbedding(samples);

                if (embedding != null) {
                    JSObject ret = new JSObject();
                    org.json.JSONArray embeddingArray = new org.json.JSONArray();
                    for (float v : embedding) {
                        embeddingArray.put(v);
                    }
                    ret.put("embedding", embeddingArray);
                    ret.put("dimension", embedding.length);
                    call.resolve(ret);
                } else {
                    call.reject("Failed to extract embedding (Audio too short or model error)");
                }
            } catch (Exception e) {
                android.util.Log.e("SpeakerEmbedding", "Error extracting embedding: " + e.getMessage(), e);
                call.reject("Error extracting embedding: " + e.getMessage(), e);
            }
        }).start();
    }

    /**
     * Extracts one embedding per time range of a 16 kHz mono PCM16 WAV file, reading only those
     * ranges. Ranges shorter than minDurationMs (default 500) get a null embedding.
     * Input: { audioPath, ranges: [{ startMs, endMs }] } -> { embeddings: [number[] | null] }
     */
    @PluginMethod
    public void extractEmbeddingsFromFile(PluginCall call) {
        String rawPath = call.getString("audioPath");
        String audioPath = rawPath != null && rawPath.startsWith("file://") ? rawPath.substring(7) : rawPath;
        com.getcapacitor.JSArray ranges = call.getArray("ranges");
        int minDurationMs = call.getInt("minDurationMs", 500);
        if (audioPath == null || ranges == null) {
            call.reject("audioPath and ranges are required");
            return;
        }
        if (!embedder.isModelLoaded()) {
            call.reject("Model not loaded");
            return;
        }
        new Thread(() -> {
            try (java.io.RandomAccessFile raf = new java.io.RandomAccessFile(audioPath, "r")) {
                long totalSamples = Math.max(0, (raf.length() - 44) / 2);
                org.json.JSONArray out = new org.json.JSONArray();
                for (int i = 0; i < ranges.length(); i++) {
                    org.json.JSONObject r = ranges.getJSONObject(i);
                    long from = Math.max(0, r.getLong("startMs") * 16);
                    long to = Math.min(totalSamples, r.getLong("endMs") * 16);
                    if ((to - from) < minDurationMs * 16L) {
                        out.put(org.json.JSONObject.NULL);
                        continue;
                    }
                    byte[] bytes = new byte[(int) (to - from) * 2];
                    raf.seek(44 + from * 2);
                    raf.readFully(bytes);
                    float[] samples = new float[bytes.length / 2];
                    for (int k = 0; k < samples.length; k++) {
                        samples[k] = (short) ((bytes[2 * k] & 0xff) | (bytes[2 * k + 1] << 8)) / 32768.0f;
                    }
                    float[] embedding = embedder.extractEmbedding(samples);
                    if (embedding == null) {
                        out.put(org.json.JSONObject.NULL);
                    } else {
                        org.json.JSONArray e = new org.json.JSONArray();
                        for (float v : embedding) {
                            e.put((double) v);
                        }
                        out.put(e);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("embeddings", out);
                call.resolve(ret);
            } catch (Exception e) {
                android.util.Log.e("SpeakerEmbedding", "extractEmbeddingsFromFile failed", e);
                call.reject("Embedding extraction failed: " + e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void getModelInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", embedder.isModelLoaded());
        ret.put("dimension", embedder.getEmbeddingDimension());
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        if (embedder != null) {
            embedder.cleanup();
        }
    }
}
