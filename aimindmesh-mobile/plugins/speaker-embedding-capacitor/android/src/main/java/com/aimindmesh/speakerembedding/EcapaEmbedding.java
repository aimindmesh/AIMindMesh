package com.aimindmesh.speakerembedding;

import android.content.Context;
import android.util.Log;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import java.io.File;
import java.nio.FloatBuffer;
import java.util.Collections;

/**
 * ECAPA-TDNN speaker embedding extraction using ONNX Runtime.
 * Designed for speaker diarization with high accuracy.
 */
public class EcapaEmbedding {
    private static final String TAG = "EcapaEmbedding";
    private static final int SAMPLE_RATE = 16000;

    private Context context;
    private OrtEnvironment env; // Lazy initialized
    private OrtSession session;
    private int embeddingDimension = 192; // Default for ECAPA-TDNN
    private boolean isLoaded = false;
    private FeatureExtractor featureExtractor;

    public EcapaEmbedding(Context context) {
        this.context = context;
        this.featureExtractor = new FeatureExtractor();
        // Note: OrtEnvironment is lazily initialized in loadModel() to avoid
        // loading native libs at plugin startup (which can cause version conflicts)
    }

    /**
     * Load ONNX model from the app's data directory.
     * 
     * @param modelPath Relative path to model file (e.g., "models/ecapa_tdnn.onnx")
     * @return true if successful
     */
    public boolean loadModel(String modelPath) {
        try {
            File modelFile = new File(context.getFilesDir(), modelPath);

            Log.d(TAG, "Loading ONNX model from: " + modelFile.getAbsolutePath());

            if (!modelFile.exists()) {
                Log.e(TAG, "Model file does not exist: " + modelFile.getAbsolutePath());
                return false;
            }

            // Unload existing session if any
            unloadModel();

            // Create session options
            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);

            // Enable NNAPI on Android for hardware acceleration
            try {
                options.addNnapi();
                Log.i(TAG, "NNAPI execution provider enabled");
            } catch (Exception e) {
                Log.w(TAG, "NNAPI not available, using CPU: " + e.getMessage());
            }

            // Lazy initialize OrtEnvironment (to avoid loading native libs at plugin
            // startup)
            if (env == null) {
                Log.d(TAG, "Initializing ONNX Runtime environment");
                env = OrtEnvironment.getEnvironment();
            }

            // Load model
            session = env.createSession(modelFile.getAbsolutePath(), options);
            isLoaded = true;

            // Try to determine embedding dimension from output shape
            try {
                String outputName = session.getOutputNames().iterator().next();
                ai.onnxruntime.NodeInfo outputInfo = session.getOutputInfo().get(outputName);
                if (outputInfo.getInfo() instanceof ai.onnxruntime.TensorInfo) {
                    ai.onnxruntime.TensorInfo tensorInfo = (ai.onnxruntime.TensorInfo) outputInfo.getInfo();
                    long[] outputShape = tensorInfo.getShape();
                    if (outputShape != null && outputShape.length >= 2) {
                        embeddingDimension = (int) outputShape[outputShape.length - 1];
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not determine embedding dimension, using default: " + embeddingDimension);
            }

            Log.i(TAG, "ONNX model loaded successfully. Embedding dimension: " + embeddingDimension);
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Failed to load ONNX model", e);
            return false;
        }
    }

    /**
     * Unload the model and release resources.
     */
    public void unloadModel() {
        if (session != null) {
            try {
                session.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing session", e);
            }
            session = null;
        }
        isLoaded = false;
    }

    /**
     * Check if a model is loaded.
     */
    public boolean isModelLoaded() {
        return isLoaded && session != null;
    }

    /**
     * Get the embedding dimension of the loaded model.
     */
    public int getEmbeddingDimension() {
        return embeddingDimension;
    }

    /**
     * Extract speaker embedding from audio samples.
     * 
     * @param audioSamples Float array of audio samples (16kHz, mono, normalized -1
     *                     to 1)
     * @return Float array embedding vector, or null on failure
     */
    public float[] extractEmbedding(float[] audioSamples) {
        if (!isModelLoaded()) {
            Log.e(TAG, "Model not loaded");
            return null;
        }

        if (audioSamples == null || audioSamples.length < SAMPLE_RATE / 10) {
            String len = audioSamples == null ? "null" : String.valueOf(audioSamples.length);
            Log.e(TAG, "Audio too short. Minimum 0.1 second required. Received: " + len + " samples");
            return null;
        }

        try {
            long startTime = System.currentTimeMillis();

            // Extract Log-Mel features
            float[][] features = featureExtractor.extractFeatures(audioSamples);

            if (features.length == 0) {
                Log.e(TAG, "Feature extraction failed or audio too short.");
                return null;
            }

            // Create input tensor [1, Frames, 80]
            // We need to flatten it for OnnxTensor.createTensor or use a 3D array wrapper
            // if supported
            // OnnxTensor.createTensor(env, Object) supports multi-dim arrays.
            // Shape: [Batch=1, Frames, Feats=80]

            // Java array to tensor:
            float[][][] inputData = new float[1][features.length][80];
            inputData[0] = features; // Wrap as batch 1

            OnnxTensor inputTensor = OnnxTensor.createTensor(env, inputData);

            // Run inference
            String inputName = session.getInputNames().iterator().next();
            OrtSession.Result result = session.run(Collections.singletonMap(inputName, inputTensor));

            // Get output tensor
            float[][] output = (float[][]) result.get(0).getValue();
            float[] embedding = output[0];

            // Normalize embedding (L2 normalization)
            float norm = 0f;
            for (float v : embedding) {
                norm += v * v;
            }
            norm = (float) Math.sqrt(norm);
            if (norm > 0) {
                for (int i = 0; i < embedding.length; i++) {
                    embedding[i] /= norm;
                }
            }

            // Cleanup
            inputTensor.close();
            result.close();

            long duration = System.currentTimeMillis() - startTime;
            Log.d(TAG, "Embedding extracted in " + duration + "ms. Dimension: " + embedding.length);

            return embedding;

        } catch (Exception e) {
            Log.e(TAG, "Failed to extract embedding", e);
            return null;
        }
    }

    /**
     * Cleanup resources.
     */
    public void cleanup() {
        unloadModel();
        if (env != null) {
            try {
                env.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing ORT environment", e);
            }
            env = null;
        }
    }
}
