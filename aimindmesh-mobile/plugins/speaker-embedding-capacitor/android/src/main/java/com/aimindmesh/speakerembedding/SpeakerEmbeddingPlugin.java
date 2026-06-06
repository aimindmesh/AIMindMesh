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
