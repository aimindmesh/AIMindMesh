package com.aimindmesh.vosk;

import android.content.Context;
import android.util.Log;

import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.SpeakerModel;

import java.io.File;
import java.io.IOException;

public class VoskRecognizer {
    private static final String TAG = "VoskRecognizer";
    private static final float SAMPLE_RATE = 16000.0f;

    private Context context;
    private VoskPlugin plugin;
    private Model model;
    private SpeakerModel spkModel;
    private String currentModelPath;
    private String currentSpkModelPath;

    // For manual processing
    private Recognizer processingRecognizer;

    public VoskRecognizer(Context context, VoskPlugin plugin) {
        this.context = context;
        this.plugin = plugin;
    }

    public boolean loadModel(String modelPath) {
        try {
            // Model path is relative to app data directory
            File modelDir = new File(context.getFilesDir(), modelPath);

            Log.d(TAG, "Attempting to load model from: " + modelDir.getAbsolutePath());

            if (!modelDir.exists()) {
                Log.e(TAG, "Model directory does not exist: " + modelDir.getAbsolutePath());
                return false;
            }

            if (!modelDir.isDirectory()) {
                Log.e(TAG, "Model path is not a directory: " + modelDir.getAbsolutePath());
                return false;
            }

            // List directory contents for debugging
            Log.d(TAG, "Directory exists. Contents:");
            File[] files = modelDir.listFiles();
            if (files != null && files.length > 0) {
                for (File file : files) {
                    Log.d(TAG, "  - " + (file.isDirectory() ? "[DIR] " : "[FILE] ") + file.getName());

                    // If it's a subdirectory, check if it might be the actual model
                    if (file.isDirectory() && file.getName().startsWith("vosk-model")) {
                        Log.d(TAG, "    Found nested vosk-model directory. Listing its contents:");
                        File[] nestedFiles = file.listFiles();
                        if (nestedFiles != null) {
                            for (File nested : nestedFiles) {
                                Log.d(TAG,
                                        "      - " + (nested.isDirectory() ? "[DIR] " : "[FILE] ") + nested.getName());
                            }
                        }
                    }
                }

                // Handle nested model directory (common issue with zip extraction)
                // If there's only one subdirectory and it starts with "vosk-model", use that
                // instead
                if (files.length == 1 && files[0].isDirectory() && files[0].getName().startsWith("vosk-model")) {
                    Log.i(TAG, "Detected nested model directory, adjusting path to: " + files[0].getName());
                    modelDir = files[0];
                    Log.d(TAG, "New model path: " + modelDir.getAbsolutePath());
                }
            } else {
                Log.e(TAG, "Directory is empty!");
                return false;
            }

            // Unload existing model if any
            unloadModel();

            // Load new model
            model = new Model(modelDir.getAbsolutePath());
            currentModelPath = modelPath;

            Log.i(TAG, "Model loaded successfully: " + modelPath);
            return true;

        } catch (IOException e) {
            Log.e(TAG, "Failed to load model", e);
            return false;
        }
    }

    public void unloadModel() {
        stopRecognition();
        if (model != null) {
            model.close();
            model = null;
        }
        currentModelPath = null;
    }

    public boolean loadSpeakerModel(String modelPath) {
        try {
            // Speaker model path is relative to app data directory
            File modelDir = new File(context.getFilesDir(), modelPath);

            Log.d(TAG, "Attempting to load speaker model from: " + modelDir.getAbsolutePath());

            if (!modelDir.exists()) {
                Log.e(TAG, "Speaker model directory does not exist: " + modelDir.getAbsolutePath());
                return false;
            }

            // Handle nested directory (common with zip extraction)
            File[] files = modelDir.listFiles();
            if (files != null && files.length == 1 && files[0].isDirectory()
                    && files[0].getName().startsWith("vosk-model-spk")) {
                Log.i(TAG, "Detected nested speaker model directory, adjusting path");
                modelDir = files[0];
            }

            // Unload existing speaker model if any
            unloadSpeakerModel();

            // Load new speaker model
            spkModel = new SpeakerModel(modelDir.getAbsolutePath());
            currentSpkModelPath = modelPath;

            Log.i(TAG, "Speaker model loaded successfully: " + modelPath);
            return true;

        } catch (IOException e) {
            Log.e(TAG, "Failed to load speaker model", e);
            return false;
        }
    }

    public void unloadSpeakerModel() {
        if (spkModel != null) {
            spkModel.close();
            spkModel = null;
        }
        currentSpkModelPath = null;
    }

    public boolean isSpeakerModelLoaded() {
        return spkModel != null;
    }

    private Thread recordingThread;
    private volatile boolean isRecording = false;

    public void startRecognition(
            OnPartialResultListener onPartial,
            OnFinalResultListener onFinal,
            OnErrorListener onError) throws Exception {

        if (model == null) {
            Log.e(TAG, "startRecognition called but no model loaded!");
            throw new Exception("No model loaded. Call loadModel() first.");
        }

        Log.i(TAG, "Starting recognition... Speaker model loaded: " + (spkModel != null));
        stopRecognition();

        try {
            Log.d(TAG, "Creating Vosk recognizer with sample rate: " + SAMPLE_RATE);

            // Create recognizer with or without speaker model
            Recognizer recognizer;
            if (spkModel != null) {
                Log.i(TAG, "Creating recognizer WITH speaker model");
                recognizer = new Recognizer(model, SAMPLE_RATE, spkModel);
            } else {
                Log.i(TAG, "Creating recognizer WITHOUT speaker model");
                recognizer = new Recognizer(model, SAMPLE_RATE);
            }

            android.media.AudioRecord audioRecord;
            int bufferSize = Math.max(
                    android.media.AudioRecord.getMinBufferSize((int) SAMPLE_RATE,
                            android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT),
                    4096);

            Log.d(TAG, "Computed buffer size: " + bufferSize);

            // Priority: UNPROCESSED (Raw) -> VOICE_RECOGNITION (Optimized for speech) ->
            // MIC (Default)
            int audioSource = android.media.MediaRecorder.AudioSource.MIC; // Default fallsafe

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                audioSource = android.media.MediaRecorder.AudioSource.UNPROCESSED;
            } else {
                audioSource = android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION;
            }

            Log.d(TAG, "Attempting to initialize AudioRecord with source: " + getSourceName(audioSource));

            audioRecord = new android.media.AudioRecord(
                    audioSource,
                    (int) SAMPLE_RATE,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize);

            if (audioRecord.getState() != android.media.AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize - state: " + audioRecord.getState());
                throw new IOException("AudioRecord failed to initialize");
            }

            Log.d(TAG, "AudioRecord initialized successfully");
            audioRecord.startRecording();
            isRecording = true;
            Log.i(TAG, "AudioRecord started recording");

            final android.media.AudioRecord finalRecord = audioRecord;

            recordingThread = new Thread(() -> {
                Log.d(TAG, "Recognition thread started");
                short[] buffer = new short[bufferSize / 2];
                int loopCount = 0;
                while (isRecording) {
                    int read = finalRecord.read(buffer, 0, buffer.length);
                    if (read > 0) {
                        loopCount++;
                        if (loopCount % 100 == 0) {
                            Log.d(TAG, "Processing audio, loop count: " + loopCount + ", bytes read: " + read);
                        }

                        // Calculate RMS
                        float rms = 0;
                        float peak = 0;
                        for (int i = 0; i < read; i++) {
                            float val = buffer[i] / 32768.0f;
                            rms += val * val;
                            if (Math.abs(val) > peak)
                                peak = Math.abs(val);
                        }
                        rms = (float) Math.sqrt(rms / read);

                        // Periodic logging (every ~5 seconds if read=bufferSize/2)
                        // bufferSize is typically 4096+, read is around 2048. 16k samples/sec.
                        // 16000 / 2048 ~= 8 reads/sec. 40 reads ~= 5 seconds.
                        if (loopCount % 40 == 0) {
                            Log.d(TAG, "Signal [" + getSourceName(finalRecord.getAudioSource()) + "]: RMS="
                                    + String.format("%.4f", rms) + ", Peak=" + String.format("%.4f", peak));
                        }

                        float normalizedLevel = Math.min(rms * 5.0f, 1.0f);

                        // Emit level
                        if (plugin != null) {
                            plugin.notifyAudioLevel(normalizedLevel);
                        }

                        if (recognizer.acceptWaveForm(buffer, read)) {
                            String result = recognizer.getResult();
                            Log.d(TAG, "Final result: " + result);
                            String text = parseHypothesis(result);
                            long[] boundaries = parseBoundaries(result);
                            float[] speakerVector = parseSpeakerVector(result);
                            if (onFinal != null && !text.isEmpty()) {
                                Log.i(TAG,
                                        "Emitting final result: " + text
                                                + (speakerVector != null
                                                        ? " with speaker vector (" + speakerVector.length + "d)"
                                                        : ""));
                                onFinal.onResult(text, speakerVector, boundaries[0], boundaries[1]);
                            }
                        } else {
                            String partial = recognizer.getPartialResult();
                            String text = parseHypothesis(partial);
                            if (onPartial != null && !text.isEmpty()) {
                                if (loopCount % 50 == 0) {
                                    Log.d(TAG, "Partial result: " + text);
                                }
                                onPartial.onResult(text);
                            }
                        }
                    } else {
                        Log.w(TAG, "AudioRecord.read returned: " + read);
                    }
                }
                Log.d(TAG, "Recognition thread stopping");
                finalRecord.stop();
                finalRecord.release();
                Log.d(TAG, "Recognition thread stopped");
            });
            recordingThread.start();

            Log.i(TAG, "Recognition started successfully");

        } catch (IOException e) {
            Log.e(TAG, "Failed to start recognition", e);
            throw new Exception("Failed to start recognition: " + e.getMessage());
        }
    }

    public void startProcessing() throws Exception {
        if (model == null) {
            throw new Exception("No model loaded");
        }

        if (processingRecognizer != null) {
            processingRecognizer.close();
        }

        if (spkModel != null) {
            processingRecognizer = new Recognizer(model, SAMPLE_RATE, spkModel);
        } else {
            processingRecognizer = new Recognizer(model, SAMPLE_RATE);
        }
    }

    public boolean processData(byte[] data, int len, OnPartialResultListener onPartial, OnFinalResultListener onFinal) {
        if (processingRecognizer == null)
            return false;

        // Vosk Recognizer.acceptWaveForm accepts short[] or byte[].
        // If byte[], it assumes PCM 16-bit mono le.
        if (processingRecognizer.acceptWaveForm(data, len)) {
            String result = processingRecognizer.getResult();
            String text = parseHypothesis(result);
            long[] boundaries = parseBoundaries(result);
            float[] spk = parseSpeakerVector(result);
            if (onFinal != null && !text.isEmpty()) {
                onFinal.onResult(text, spk, boundaries[0], boundaries[1]);
            }
            return true; // Result produced
        } else {
            String partial = processingRecognizer.getPartialResult();
            String text = parseHypothesis(partial);
            if (onPartial != null && !text.isEmpty()) {
                onPartial.onResult(text);
            }
            return false;
        }
    }

    public void stopProcessing(OnFinalResultListener onFinal) {
        if (processingRecognizer != null) {
            String result = processingRecognizer.getFinalResult();
            String text = parseHypothesis(result);
            long[] boundaries = parseBoundaries(result);
            float[] spk = parseSpeakerVector(result);
            if (onFinal != null && !text.isEmpty()) {
                onFinal.onResult(text, spk, boundaries[0], boundaries[1]);
            }
            processingRecognizer.close();
            processingRecognizer = null;
        }
    }

    public void stopRecognition() {
        isRecording = false;
        if (recordingThread != null) {
            try {
                recordingThread.join(1000);
            } catch (InterruptedException e) {
                Log.e(TAG, "Interrupted while waiting for recording thread to stop");
            }
            recordingThread = null;
        }
        Log.d(TAG, "Recognition stopped");
    }

    public boolean isModelLoaded() {
        return model != null;
    }

    public String[] getModelInfo() {
        if (model != null) {
            // Return model path and try to extract language from path
            String language = extractLanguage(currentModelPath);
            return new String[] { currentModelPath, language };
        }
        return new String[] { null, null };
    }

    public void cleanup() {
        unloadModel();
    }

    private String parseHypothesis(String hypothesis) {
        // Vosk returns JSON like: {"text": "hello world"} or {"partial": "hello"}
        try {
            org.json.JSONObject json = new org.json.JSONObject(hypothesis);
            // Try "text" first (final result), then "partial"
            if (json.has("text")) {
                return json.optString("text", "");
            } else if (json.has("partial")) {
                return json.optString("partial", "");
            }
            return "";
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse hypothesis: " + hypothesis, e);
            return "";
        }
    }

    private long[] parseBoundaries(String result) {
        // Vosk returns words array if words are enabled: {"result": [{"conf": 1.0,
        // "end": 1.5, "start": 0.5, "word": "hello"}...]}
        long startMs = 0;
        long endMs = 0;
        try {
            org.json.JSONObject json = new org.json.JSONObject(result);
            if (json.has("result")) {
                org.json.JSONArray words = json.getJSONArray("result");
                if (words.length() > 0) {
                    // First word start time
                    startMs = (long) (words.getJSONObject(0).getDouble("start") * 1000);
                    // Last word end time
                    endMs = (long) (words.getJSONObject(words.length() - 1).getDouble("end") * 1000);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse boundaries: " + e.getMessage());
        }
        return new long[] { startMs, endMs };
    }

    private float[] parseSpeakerVector(String result) {
        // Vosk returns speaker vector as: {"spk": [0.1, 0.2, ...], "spk_frames": 123,
        // "text": "..."}
        try {
            org.json.JSONObject json = new org.json.JSONObject(result);
            if (json.has("spk")) {
                org.json.JSONArray spkArray = json.getJSONArray("spk");
                float[] vector = new float[spkArray.length()];
                for (int i = 0; i < spkArray.length(); i++) {
                    vector[i] = (float) spkArray.getDouble(i);
                }
                Log.d(TAG, "Parsed speaker vector with " + vector.length + " dimensions");
                return vector;
            }
        } catch (Exception e) {
            Log.d(TAG, "No speaker vector in result: " + e.getMessage());
        }
        return null;
    }

    private String extractLanguage(String modelPath) {
        if (modelPath == null)
            return null;

        // Try to extract language from model path
        // Examples: "vosk-model-en-us-0.22", "vosk-model-it-0.22"
        if (modelPath.contains("-en-"))
            return "en";
        if (modelPath.contains("-it-"))
            return "it";
        if (modelPath.contains("-fr-"))
            return "fr";
        if (modelPath.contains("-de-"))
            return "de";
        if (modelPath.contains("-es-"))
            return "es";

        return "unknown";
    }

    private String getSourceName(int source) {
        switch (source) {
            case android.media.MediaRecorder.AudioSource.MIC:
                return "MIC";
            case android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION:
                return "VOICE_RECOGNITION";
            case 9:
                return "UNPROCESSED"; // MediaRecorder.AudioSource.UNPROCESSED (API 24+)
            case android.media.MediaRecorder.AudioSource.VOICE_COMMUNICATION:
                return "VOICE_COMMUNICATION";
            case android.media.MediaRecorder.AudioSource.CAMCORDER:
                return "CAMCORDER";
            case android.media.MediaRecorder.AudioSource.DEFAULT:
                return "DEFAULT";
            default:
                return "UNKNOWN(" + source + ")";
        }
    }

    interface OnPartialResultListener {
        void onResult(String text);
    }

    interface OnFinalResultListener {
        void onResult(String text, float[] speakerVector, long startMs, long endMs);
    }

    interface OnErrorListener {
        void onError(String message);
    }
}
