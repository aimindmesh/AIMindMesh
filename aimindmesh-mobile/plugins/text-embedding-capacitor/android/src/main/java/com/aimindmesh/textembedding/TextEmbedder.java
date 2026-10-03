package com.aimindmesh.textembedding;

import android.content.Context;
import android.util.Log;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.TensorInfo;
import ai.onnxruntime.OnnxJavaType;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Text embedder using ONNX Runtime with a HuggingFace tokenizer (WordPiece or Unigram).
 * Supports models like all-MiniLM-L6-v2, E5, BGE and multilingual-e5.
 */
public class TextEmbedder {
    private static final String TAG = "TextEmbedder";
    /** Input cap when the model files do not declare one (BERT-family position limit) */
    private static final int DEFAULT_MAX_SEQUENCE_LENGTH = 512;

    private final Context context;
    private OrtEnvironment env;
    private OrtSession session;
    private EmbeddingTokenizer tokenizer;
    private int embeddingDimension = 384; // Default for MiniLM
    private int maxSequenceLength = DEFAULT_MAX_SEQUENCE_LENGTH;
    private String loadedModelDir;
    private boolean isLoaded = false;
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    public TextEmbedder(Context context) {
        this.context = context;
        this.env = OrtEnvironment.getEnvironment();
    }

    /**
     * Load model from directory containing model.onnx, tokenizer.json, config.json.
     * The new model is built completely before it replaces the current one, so a failed load
     * leaves the previous model usable, and the replaced session is closed (no native leak).
     *
     * @param modelDir Directory path relative to app data
     * @return Embedding dimension on success
     */
    public int loadModel(String modelDir) throws Exception {
        lock.writeLock().lock();
        try {
            if (isLoaded && session != null && modelDir.equals(loadedModelDir)) {
                Log.i(TAG, "Model already loaded: " + modelDir);
                return embeddingDimension;
            }

            File modelDirectory = new File(context.getFilesDir(), modelDir);
            if (!modelDirectory.exists()) {
                throw new IOException("Model directory not found: " + modelDirectory.getAbsolutePath());
            }

            // config.json: dimension and position limit (downloaded models may only declare hidden_size)
            int dimension = -1;
            int maxLength = DEFAULT_MAX_SEQUENCE_LENGTH;
            File configFile = new File(modelDirectory, "config.json");
            if (configFile.exists()) {
                try (FileReader reader = new FileReader(configFile)) {
                    JsonObject config = new Gson().fromJson(reader, JsonObject.class);
                    if (config != null && config.has("hidden_size")) {
                        dimension = config.get("hidden_size").getAsInt();
                    }
                    if (config != null && config.has("max_position_embeddings")) {
                        maxLength = Math.min(config.get("max_position_embeddings").getAsInt(), DEFAULT_MAX_SEQUENCE_LENGTH);
                    }
                }
            }

            File tokenizerFile = new File(modelDirectory, "tokenizer.json");
            if (!tokenizerFile.exists()) {
                throw new IOException("tokenizer.json not found in model directory");
            }
            TokenizerJson.Loaded loadedTokenizer = TokenizerJson.load(tokenizerFile, new File(modelDirectory, "tokenizer_config.json"));
            if (loadedTokenizer.maxLength > 0) maxLength = Math.min(maxLength, loadedTokenizer.maxLength);
            Log.i(TAG, "Tokenizer loaded (" + loadedTokenizer.tokenizer.getClass().getSimpleName() + "), maxLen=" + maxLength);

            File modelFile = new File(modelDirectory, "model.onnx");
            if (!modelFile.exists()) {
                throw new IOException("model.onnx not found in model directory");
            }

            OrtSession.SessionOptions sessionOptions = new OrtSession.SessionOptions();
            sessionOptions.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.BASIC_OPT);
            // Use 1 thread for inference to prevent deadlocks with LlamaCpp/LiteRT thread pools
            sessionOptions.setIntraOpNumThreads(1);
            sessionOptions.setInterOpNumThreads(1);
            OrtSession newSession = env.createSession(modelFile.getAbsolutePath(), sessionOptions);
            if (dimension <= 0) dimension = outputDimension(newSession);
            if (dimension <= 0) dimension = 384;

            OrtSession previous = session;
            session = newSession;
            tokenizer = loadedTokenizer.tokenizer;
            embeddingDimension = dimension;
            maxSequenceLength = maxLength;
            loadedModelDir = modelDir;
            isLoaded = true;
            if (previous != null) {
                try {
                    previous.close();
                } catch (Exception e) {
                    Log.e(TAG, "Error closing previous session", e);
                }
            }
            Log.i(TAG, "ONNX session created: dim=" + dimension + ", maxLen=" + maxLength);
            return embeddingDimension;
        } finally {
            lock.writeLock().unlock();
        }
    }

    /** Last dimension of the first output with a known shape, -1 when not declared. */
    private static int outputDimension(OrtSession newSession) {
        try {
            for (NodeInfo info : newSession.getOutputInfo().values()) {
                if (info.getInfo() instanceof TensorInfo) {
                    long[] shape = ((TensorInfo) info.getInfo()).getShape();
                    if (shape.length >= 2 && shape[shape.length - 1] > 0) return (int) shape[shape.length - 1];
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read output shape", e);
        }
        return -1;
    }

    /**
     * Generate embedding for a single text
     */
    public float[] generateEmbedding(String text) throws Exception {
        lock.readLock().lock();
        try {
            if (!isLoaded || session == null || tokenizer == null) {
                throw new IllegalStateException("Model not loaded");
            }

            TokenizerOutput tokens = tokenizer.encode(text, maxSequenceLength);

            long[] inputIds = tokens.inputIds;
            long[] attentionMask = tokens.attentionMask;
            long[] tokenTypeIds = tokens.tokenTypeIds;

            Map<String, OnnxTensor> inputs = new HashMap<>();
            Map<String, NodeInfo> inputInfo = session.getInputInfo();

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

            OrtSession.Result result = session.run(inputs);

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
            loadedModelDir = null;
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

    /** Directory of the loaded model (null when none): JS compares it with the selected model. */
    public String getLoadedModelDir() {
        return loadedModelDir;
    }

    /**
     * Helper class to hold tokenizer output
     */
    public static class TokenizerOutput {
        public long[] inputIds;
        public long[] attentionMask;
        public long[] tokenTypeIds;

        /** Single unpadded sequence: every position attended, one segment. */
        static TokenizerOutput of(long[] inputIds) {
            TokenizerOutput output = new TokenizerOutput();
            output.inputIds = inputIds;
            output.attentionMask = new long[inputIds.length];
            java.util.Arrays.fill(output.attentionMask, 1L);
            output.tokenTypeIds = new long[inputIds.length];
            return output;
        }
    }
}
