package com.aimindmesh.vad;

import android.content.Context;
import android.util.Log;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Silero VAD implementation using ONNX Runtime.
 * 
 * Silero VAD v4 expects:
 * - Input: audio chunks (512 samples at 16kHz = 32ms per chunk)
 * - State tensors: h, c (internal LSTM state)
 * - sr tensor: sample rate (16000)
 *
 * Silero VAD v5 (what the download URL on the repo's master branch now serves) instead takes a
 * single "state" tensor [2,1,128] and expects the last 64 samples of the previous window
 * prepended to each 512-sample window. Both layouts are detected from the model's inputs.
 * 
 * Output: speech probability (0-1)
 *
 * Methods are synchronized: processFile runs on a worker thread while load/unload/reset come
 * from the plugin thread, and closing the session mid-inference crashed natively.
 */
public class SileroVAD {
    private static final String TAG = "SileroVAD";

    // Model parameters
    private static final int SAMPLE_RATE = 16000;
    private static final int WINDOW_SIZE = 512; // 32ms at 16kHz

    // ONNX Runtime
    private OrtEnvironment ortEnv;
    private OrtSession ortSession;
    private boolean isLoaded = false;

    // Internal state for streaming
    private float[] hState = new float[2 * 64]; // 2 layers * 64 hidden
    private float[] cState = new float[2 * 64];
    private long sampleCount = 0;

    // v5 layout
    private static final int V5_CONTEXT_SIZE = 64;
    private boolean isV5 = false;
    private float[] v5State = new float[2 * 128];
    private float[] v5Context = new float[V5_CONTEXT_SIZE];
    private long[] srShape = { 1 };

    // VAD thresholds
    private float speechThreshold = 0.5f;
    private int silenceDurationMs = 300;
    private int minSpeechDurationMs = 250;

    // State for segment detection
    private boolean inSpeech = false;
    private long speechStartSample = 0;
    private int silentFrames = 0;
    private int silentFrameThreshold;

    private Context appContext;

    public SileroVAD(Context context) {
        this.appContext = context.getApplicationContext();
        this.silentFrameThreshold = (silenceDurationMs * SAMPLE_RATE / 1000) / WINDOW_SIZE;
    }

    /**
     * Load the ONNX model
     * 
     * @param modelPath Absolute path to the .onnx file
     * @return true if successful
     */
    public synchronized boolean loadModel(String modelPath) {
        try {
            if (isLoaded) {
                release();
            }

            ortEnv = OrtEnvironment.getEnvironment();

            OrtSession.SessionOptions sessionOptions = new OrtSession.SessionOptions();
            sessionOptions.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);

            // Load model from file
            ortSession = ortEnv.createSession(modelPath, sessionOptions);
            isV5 = ortSession.getInputNames().contains("state");
            srShape = readInputShape("sr", new long[] { 1 });
            Log.i(TAG, "Silero VAD layout: " + (isV5 ? "v5 (state)" : "v4 (h/c)") + ", sr rank " + srShape.length);

            // Reset state
            reset();
            isLoaded = true;

            Log.i(TAG, "Silero VAD model loaded successfully");
            return true;

        } catch (Exception e) {
            Log.e(TAG, "Failed to load VAD model", e);
            return false;
        }
    }

    /**
     * Process audio samples for speech detection
     * 
     * @param samples Float array of audio samples (16kHz mono, normalized -1 to 1)
     * @return VAD result
     */
    public synchronized VADResult processSamples(float[] samples) {
        if (!isLoaded || ortSession == null) {
            throw new IllegalStateException("Model not loaded");
        }

        VADResult result = new VADResult();

        try {
            // Process in chunks of WINDOW_SIZE
            int numChunks = samples.length / WINDOW_SIZE;
            float maxProb = 0;

            for (int i = 0; i < numChunks; i++) {
                // Extract chunk
                float[] chunk = new float[WINDOW_SIZE];
                System.arraycopy(samples, i * WINDOW_SIZE, chunk, 0, WINDOW_SIZE);

                // Run inference
                float prob = runInference(chunk);
                maxProb = Math.max(maxProb, prob);

                // Update state machine
                boolean isSpeechFrame = prob >= speechThreshold;

                if (isSpeechFrame && !inSpeech) {
                    // Speech started
                    inSpeech = true;
                    speechStartSample = sampleCount;
                    silentFrames = 0;
                    result.speechStartMs = (speechStartSample * 1000L) / SAMPLE_RATE;
                } else if (!isSpeechFrame && inSpeech) {
                    silentFrames++;
                    if (silentFrames >= silentFrameThreshold) {
                        // Speech ended
                        long speechDurationMs = ((sampleCount - speechStartSample) * 1000L) / SAMPLE_RATE;
                        if (speechDurationMs >= minSpeechDurationMs) {
                            result.speechEndMs = (sampleCount * 1000L) / SAMPLE_RATE;
                        }
                        inSpeech = false;
                        silentFrames = 0;
                    }
                } else if (isSpeechFrame && inSpeech) {
                    silentFrames = 0;
                }

                sampleCount += WINDOW_SIZE;
            }

            result.isSpeech = inSpeech || maxProb >= speechThreshold;
            result.confidence = maxProb;

        } catch (Exception e) {
            Log.e(TAG, "Error processing samples", e);
            result.isSpeech = false;
            result.confidence = 0;
        }

        return result;
    }

    /**
     * Run inference on a single chunk
     */
    private float runInference(float[] chunk) throws Exception {
        return isV5 ? runInferenceV5(chunk) : runInferenceV4(chunk);
    }

    private OnnxTensor createSrTensor() throws Exception {
        // v5 declares sr as a scalar; feeding a [1] tensor fails its rank check
        long[] shape = srShape.length == 0 ? new long[0] : new long[] { 1 };
        return OnnxTensor.createTensor(ortEnv, java.nio.LongBuffer.wrap(new long[] { SAMPLE_RATE }), shape);
    }

    private long[] readInputShape(String name, long[] fallback) {
        try {
            NodeInfo info = ortSession.getInputInfo().get(name);
            if (info != null && info.getInfo() instanceof TensorInfo) {
                return ((TensorInfo) info.getInfo()).getShape();
            }
        } catch (Exception e) {
            Log.w(TAG, "Cannot read input shape of " + name, e);
        }
        return fallback;
    }

    private float runInferenceV5(float[] chunk) throws Exception {
        float[] input = new float[V5_CONTEXT_SIZE + chunk.length];
        System.arraycopy(v5Context, 0, input, 0, V5_CONTEXT_SIZE);
        System.arraycopy(chunk, 0, input, V5_CONTEXT_SIZE, chunk.length);

        OnnxTensor inputTensor = OnnxTensor.createTensor(ortEnv,
                FloatBuffer.wrap(input), new long[] { 1, input.length });
        OnnxTensor stateTensor = OnnxTensor.createTensor(ortEnv,
                FloatBuffer.wrap(v5State), new long[] { 2, 1, 128 });
        OnnxTensor srTensor = createSrTensor();

        Map<String, OnnxTensor> inputs = new HashMap<>();
        inputs.put("input", inputTensor);
        inputs.put("state", stateTensor);
        inputs.put("sr", srTensor);

        try (OrtSession.Result result = ortSession.run(inputs)) {
            float[][] output = (float[][]) result.get(0).getValue();
            float[][][] stateOut = (float[][][]) result.get(1).getValue();
            int idx = 0;
            for (int l = 0; l < 2; l++) {
                for (int h = 0; h < 128; h++) {
                    v5State[idx++] = stateOut[l][0][h];
                }
            }
            System.arraycopy(chunk, chunk.length - V5_CONTEXT_SIZE, v5Context, 0, V5_CONTEXT_SIZE);
            return output[0][0];
        } finally {
            inputTensor.close();
            stateTensor.close();
            srTensor.close();
        }
    }

    private float runInferenceV4(float[] chunk) throws Exception {
        // Create input tensors
        long[] inputShape = { 1, WINDOW_SIZE };
        long[] stateShape = { 2, 1, 64 };

        OnnxTensor inputTensor = OnnxTensor.createTensor(ortEnv,
                FloatBuffer.wrap(chunk), inputShape);
        OnnxTensor hTensor = OnnxTensor.createTensor(ortEnv,
                FloatBuffer.wrap(hState), stateShape);
        OnnxTensor cTensor = OnnxTensor.createTensor(ortEnv,
                FloatBuffer.wrap(cState), stateShape);
        OnnxTensor srTensor = createSrTensor();

        // Prepare inputs
        Map<String, OnnxTensor> inputs = new HashMap<>();
        inputs.put("input", inputTensor);
        inputs.put("h", hTensor);
        inputs.put("c", cTensor);
        inputs.put("sr", srTensor);

        try {
            // Run inference
            OrtSession.Result result = ortSession.run(inputs);

            // Get output
            float[][] output = (float[][]) result.get(0).getValue();
            float prob = output[0][0];

            // Update state tensors
            float[][][] hOut = (float[][][]) result.get(1).getValue();
            float[][][] cOut = (float[][][]) result.get(2).getValue();

            // Flatten state tensors
            int idx = 0;
            for (int l = 0; l < 2; l++) {
                for (int h = 0; h < 64; h++) {
                    hState[idx] = hOut[l][0][h];
                    cState[idx] = cOut[l][0][h];
                    idx++;
                }
            }

            result.close();
            return prob;

        } finally {
            inputTensor.close();
            hTensor.close();
            cTensor.close();
            srTensor.close();
        }
    }

    /**
     * Process an audio file and extract speech segments
     * 
     * @param audioPath Path to WAV file (16kHz mono)
     * @return List of speech segments
     */
    public synchronized List<SpeechSegment> processFile(String audioPath) throws IOException {
        List<SpeechSegment> segments = new ArrayList<>();

        // Reset state for file processing
        reset();

        // Read WAV file
        File audioFile = new File(audioPath);
        float[] samples = readWavFile(audioFile);

        if (samples == null || samples.length == 0) {
            return segments;
        }

        // Process in chunks
        List<Float> probs = new ArrayList<>();
        int numChunks = samples.length / WINDOW_SIZE;

        for (int i = 0; i < numChunks; i++) {
            float[] chunk = new float[WINDOW_SIZE];
            System.arraycopy(samples, i * WINDOW_SIZE, chunk, 0, WINDOW_SIZE);

            try {
                float prob = runInference(chunk);
                probs.add(prob);
            } catch (Exception e) {
                Log.e(TAG, "Inference error at chunk " + i, e);
                probs.add(0f);
            }
        }

        // Extract segments from probabilities
        boolean inSegment = false;
        int segmentStart = 0;
        int silentCount = 0;
        int silentThreshold = silenceDurationMs / (WINDOW_SIZE * 1000 / SAMPLE_RATE);

        for (int i = 0; i < probs.size(); i++) {
            boolean isSpeech = probs.get(i) >= speechThreshold;

            if (isSpeech && !inSegment) {
                inSegment = true;
                segmentStart = i;
                silentCount = 0;
            } else if (!isSpeech && inSegment) {
                silentCount++;
                if (silentCount >= silentThreshold) {
                    long startMs = (long) segmentStart * WINDOW_SIZE * 1000 / SAMPLE_RATE;
                    long endMs = (long) (i - silentCount) * WINDOW_SIZE * 1000 / SAMPLE_RATE;

                    if (endMs - startMs >= minSpeechDurationMs) {
                        SpeechSegment seg = new SpeechSegment();
                        seg.startMs = startMs;
                        seg.endMs = endMs;
                        segments.add(seg);
                    }
                    inSegment = false;
                }
            } else if (isSpeech && inSegment) {
                silentCount = 0;
            }
        }

        // Handle segment at end of file
        if (inSegment) {
            long startMs = (long) segmentStart * WINDOW_SIZE * 1000 / SAMPLE_RATE;
            long endMs = (long) probs.size() * WINDOW_SIZE * 1000 / SAMPLE_RATE;

            if (endMs - startMs >= minSpeechDurationMs) {
                SpeechSegment seg = new SpeechSegment();
                seg.startMs = startMs;
                seg.endMs = endMs;
                segments.add(seg);
            }
        }

        return segments;
    }

    /**
     * Read WAV file and return samples as float array
     */
    private float[] readWavFile(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            // Skip WAV header (44 bytes for standard PCM WAV)
            byte[] header = new byte[44];
            fis.read(header);

            // Read audio data
            int dataSize = (int) file.length() - 44;
            byte[] data = new byte[dataSize];
            fis.read(data);

            // Convert to float
            float[] samples = new float[dataSize / 2];
            ByteBuffer bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);

            for (int i = 0; i < samples.length; i++) {
                samples[i] = bb.getShort() / 32768.0f;
            }

            return samples;
        }
    }

    /**
     * Reset internal state
     */
    public synchronized void reset() {
        hState = new float[2 * 64];
        cState = new float[2 * 64];
        v5State = new float[2 * 128];
        v5Context = new float[V5_CONTEXT_SIZE];
        sampleCount = 0;
        inSpeech = false;
        speechStartSample = 0;
        silentFrames = 0;
    }

    /**
     * Release resources
     */
    public synchronized void release() {
        if (ortSession != null) {
            try {
                ortSession.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing session", e);
            }
            ortSession = null;
        }
        // NOTE: Do NOT close ortEnv — OrtEnvironment.getEnvironment() returns a
        // process-global singleton shared with ECAPA speaker embedding and other
        // ONNX plugins. Closing it here would crash other plugins.
        isLoaded = false;
    }

    // Setters for thresholds
    public synchronized void setSpeechThreshold(float threshold) {
        this.speechThreshold = threshold;
    }

    public synchronized void setSilenceDurationMs(int durationMs) {
        this.silenceDurationMs = durationMs;
        this.silentFrameThreshold = (durationMs * SAMPLE_RATE / 1000) / WINDOW_SIZE;
    }

    public synchronized void setMinSpeechDurationMs(int durationMs) {
        this.minSpeechDurationMs = durationMs;
    }

    /**
     * VAD result for streaming mode
     */
    public static class VADResult {
        public boolean isSpeech = false;
        public float confidence = 0;
        public Long speechStartMs = null;
        public Long speechEndMs = null;
    }

    /**
     * Speech segment
     */
    public static class SpeechSegment {
        public long startMs;
        public long endMs;
    }
}
