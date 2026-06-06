package com.aimindmesh.textembedding;

import android.content.Context;
import android.util.Log;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.TensorInfo;
import ai.onnxruntime.OnnxJavaType;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Text embedder using ONNX Runtime with HuggingFace tokenizer.
 * Supports models like all-MiniLM-L6-v2.
 */
public class TextEmbedder {
    private static final String TAG = "TextEmbedder";

    private final Context context;
    private OrtEnvironment env;
    private OrtSession session;
    private BertTokenizer tokenizer;
    private int embeddingDimension = 384; // Default for MiniLM
    private int maxSequenceLength = 128;
    private boolean isLoaded = false;
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    public TextEmbedder(Context context) {
        this.context = context;
        this.env = OrtEnvironment.getEnvironment();
    }

    /**
     * Load model from directory containing model.onnx, tokenizer.json, config.json
     * 
     * @param modelDir Directory path relative to app data
     * @return Embedding dimension on success, -1 on failure
     */
    public int loadModel(String modelDir) throws Exception {
        lock.writeLock().lock();
        try {
            // Resolve full model directory path
            File baseDir = context.getFilesDir();
            File modelDirectory = new File(baseDir, modelDir);

            if (!modelDirectory.exists()) {
                throw new IOException("Model directory not found: " + modelDirectory.getAbsolutePath());
            }

            // Load config.json to get model parameters
            File configFile = new File(modelDirectory, "config.json");
            if (configFile.exists()) {
                try (FileReader reader = new FileReader(configFile)) {
                    Gson gson = new Gson();
                    JsonObject config = gson.fromJson(reader, JsonObject.class);
                    if (config.has("hidden_size")) {
                        embeddingDimension = config.get("hidden_size").getAsInt();
                    }
                    if (config.has("max_position_embeddings")) {
                        maxSequenceLength = Math.min(config.get("max_position_embeddings").getAsInt(), 512);
                    }
                }
            }
            Log.i(TAG, "Config loaded: dim=" + embeddingDimension + ", maxLen=" + maxSequenceLength);

            // Load tokenizer
            File tokenizerFile = new File(modelDirectory, "tokenizer.json");
            File tokenizerConfigFile = new File(modelDirectory, "tokenizer_config.json");
            if (!tokenizerFile.exists()) {
                throw new IOException("tokenizer.json not found in model directory");
            }
            tokenizer = new BertTokenizer(tokenizerFile, tokenizerConfigFile);
            Log.i(TAG, "Tokenizer loaded");

            // Load ONNX model
            File modelFile = new File(modelDirectory, "model.onnx");
            if (!modelFile.exists()) {
                throw new IOException("model.onnx not found in model directory");
            }

            OrtSession.SessionOptions sessionOptions = new OrtSession.SessionOptions();
            sessionOptions.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.BASIC_OPT);
            // Use 1 thread for inference to prevent deadlocks with LlamaCpp/LiteRT thread pools
            sessionOptions.setIntraOpNumThreads(1);
            sessionOptions.setInterOpNumThreads(1);

            session = env.createSession(modelFile.getAbsolutePath(), sessionOptions);
            Log.i(TAG, "ONNX session created");

            isLoaded = true;
            return embeddingDimension;
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * Generate embedding for a single text
     */
    public float[] generateEmbedding(String text) throws Exception {
        Log.i(TAG, "generateEmbedding: acquiring readLock");
        lock.readLock().lock();
        try {
            Log.i(TAG, "generateEmbedding: readLock acquired, checking state");
            if (!isLoaded || session == null || tokenizer == null) {
                throw new IllegalStateException("Model not loaded");
            }

            Log.i(TAG, "generateEmbedding: Tokenizing text");
            // Tokenize text
            TokenizerOutput tokens = tokenizer.encode(text, maxSequenceLength);

            Log.i(TAG, "generateEmbedding: Creating input tensors");
            // Create input tensors
            long[] inputIds = tokens.inputIds;
            long[] attentionMask = tokens.attentionMask;
            long[] tokenTypeIds = tokens.tokenTypeIds;

            Map<String, OnnxTensor> inputs = new HashMap<>();

            Log.i(TAG, "generateEmbedding: Analyzing model inputs");
            // Analyze model inputs
            Map<String, NodeInfo> inputInfo = session.getInputInfo();
            Log.i(TAG, "generateEmbedding: Preparing data arrays");

            // Helper to create tensor with correct type
            for (String inputName : inputInfo.keySet()) {
                NodeInfo info = inputInfo.get(inputName);
                if (info == null)
                    continue;

                TensorInfo tensorInfo = (TensorInfo) info.getInfo();
                OnnxJavaType type = tensorInfo.type;

                long[] data = null;
                if (inputName.equals("input_ids"))
                    data = inputIds;
                else if (inputName.equals("attention_mask"))
                    data = attentionMask;
                else if (inputName.equals("token_type_ids"))
                    data = tokenTypeIds;

                if (data != null) {
                    if (type == OnnxJavaType.INT64) {
                        inputs.put(inputName, OnnxTensor.createTensor(env, new long[][] { data }));
                    } else if (type == OnnxJavaType.INT32) {
                        // Convert to int
                        int[] intData = new int[data.length];
                        for (int i = 0; i < data.length; i++)
                            intData[i] = (int) data[i];
                        inputs.put(inputName, OnnxTensor.createTensor(env, new int[][] { intData }));
                    } else {
                        Log.w(TAG, "Unsupported input type for " + inputName + ": " + type);
                    }
                }
            }

            // Run inference
            Log.i(TAG, "Calling ONNX session.run()");
            OrtSession.Result result = session.run(inputs);
            Log.i(TAG, "ONNX session.run() completed");

            // Get output - different models have different output names
            // Try common names: last_hidden_state, sentence_embedding, embeddings
            float[] embedding = null;

            // Get output names from session metadata
            java.util.Set<String> outputNames = session.getOutputNames();
            for (String outputName : outputNames) {
                try {
                    Object output = result.get(outputName).get().getValue();
                    if (output instanceof float[][][]) {
                        // Shape: [1, seq_len, hidden_size] - take mean pooling
                        float[][][] hidden = (float[][][]) output;
                        embedding = meanPooling(hidden[0], attentionMask);
                        break;
                    } else if (output instanceof float[][]) {
                        // Shape: [1, hidden_size] - already pooled
                        float[][] pooled = (float[][]) output;
                        embedding = pooled[0];
                        break;
                    }
                } catch (Exception e) {
                    Log.d(TAG, "Could not extract from output: " + outputName);
                }
            }

            // Close tensors
            for (OnnxTensor tensor : inputs.values()) {
                tensor.close();
            }
            result.close();

            if (embedding != null) {
                // L2 normalize
                embedding = l2Normalize(embedding);
            }

            return embedding;
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Mean pooling over hidden states with attention mask
     */
    private float[] meanPooling(float[][] hiddenStates, long[] attentionMask) {
        int seqLen = hiddenStates.length;
        int hiddenSize = hiddenStates[0].length;

        float[] summed = new float[hiddenSize];
        float maskSum = 0;

        for (int i = 0; i < seqLen; i++) {
            float mask = attentionMask[i];
            maskSum += mask;
            for (int j = 0; j < hiddenSize; j++) {
                summed[j] += hiddenStates[i][j] * mask;
            }
        }

        if (maskSum > 0) {
            for (int j = 0; j < hiddenSize; j++) {
                summed[j] /= maskSum;
            }
        }

        return summed;
    }

    /**
     * L2 normalize embedding vector
     */
    private float[] l2Normalize(float[] vec) {
        float norm = 0;
        for (float v : vec) {
            norm += v * v;
        }
        norm = (float) Math.sqrt(norm);

        if (norm > 0) {
            for (int i = 0; i < vec.length; i++) {
                vec[i] /= norm;
            }
        }
        return vec;
    }

    public void unloadModel() {
        lock.writeLock().lock();
        try {
            if (session != null) {
                try {
                    session.close();
                } catch (Exception e) {
                    Log.e(TAG, "Error closing session", e);
                }
                session = null;
            }
            tokenizer = null;
            isLoaded = false;
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void cleanup() {
        unloadModel();
        if (env != null) {
            try {
                env.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing environment", e);
            }
        }
    }

    public boolean isModelLoaded() {
        return isLoaded && session != null;
    }

    public int getEmbeddingDimension() {
        return embeddingDimension;
    }

    /**
     * Helper class to hold tokenizer output
     */
    public static class TokenizerOutput {
        public long[] inputIds;
        public long[] attentionMask;
        public long[] tokenTypeIds;
    }
}
