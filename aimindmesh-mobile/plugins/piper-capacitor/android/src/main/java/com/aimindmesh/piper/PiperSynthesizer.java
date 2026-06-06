package com.aimindmesh.piper;

import android.content.Context;
import android.media.MediaPlayer;
import android.util.Log;

import java.io.File;
import java.io.IOException;

// Native Piper implementation using ONNX Runtime
public class PiperSynthesizer {
    private static final String TAG = "PiperSynthesizer";
    private Context context;
    private android.media.AudioManager audioManager;
    private String currentVoiceId;
    private boolean isLoaded = false;
    private MediaPlayer mediaPlayer;

    // Load native library
    static {
        try {
            // Explicitly load dependency first to ensure symbols are available
            try {
                System.loadLibrary("onnxruntime");
            } catch (UnsatisfiedLinkError e) {
                Log.e(TAG, "Failed to load onnxruntime shared library", e);
            }
            System.loadLibrary("piper_jni");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load native library piper_jni", e);
            // Don't swallow the error, let it crash or be handled by the caller checking
            // isLoaded
            // But static block can't throw checked exceptions.
            // We set a flag or just log fatal.
            // Actually, if we swallow it here, standard JNI calls will throw "No
            // implementation found".
            // Let's log heavily.
            throw e;
        }
    }

    // Native methods
    private native boolean nativeLoadVoice(String modelPath, String configPath);

    private native String nativeSynthesize(long[] phonemeIds);

    private native void nativeUnload();

    public PiperSynthesizer(Context context) {
        this.context = context;
        this.audioManager = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    public void setAudioOutput(String outputType) {
        Log.i(TAG, "Setting audio output to: " + outputType);
        if (audioManager == null)
            return;

        switch (outputType) {
            case "earpiece":
                audioManager.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(false);
                break;
            case "speaker":
                audioManager.setMode(android.media.AudioManager.MODE_NORMAL);
                audioManager.setSpeakerphoneOn(true);
                break;
            case "bluetooth":
                audioManager.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
                audioManager.startBluetoothSco();
                audioManager.setBluetoothScoOn(true);
                break;
            case "wired":
                audioManager.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(false);
                break;
            default:
                Log.w(TAG, "Unknown audio output type: " + outputType);
                // Default to speaker
                audioManager.setMode(android.media.AudioManager.MODE_NORMAL);
                audioManager.setSpeakerphoneOn(true);
        }
    }

    public java.util.List<String> getAvailableAudioOutputs() {
        java.util.List<String> outputs = new java.util.ArrayList<>();
        outputs.add("speaker");
        outputs.add("earpiece");

        if (audioManager != null) {
            if (audioManager.isBluetoothScoAvailableOffCall()) {
                outputs.add("bluetooth");
            }
            if (audioManager.isWiredHeadsetOn()) {
                outputs.add("wired");
            }
        }
        return outputs;
    }

    public boolean loadVoice(String modelPath, String configPath) {
        try {
            File modelFile = new File(context.getFilesDir(), modelPath);
            File configFile = new File(context.getFilesDir(), configPath);

            if (!modelFile.exists() || !configFile.exists()) {
                Log.e(TAG, "Voice files do not exist: " + modelFile.getAbsolutePath());
                return false;
            }

            Log.i(TAG, "Loading native voice model: " + modelFile.getAbsolutePath());
            boolean success = nativeLoadVoice(modelFile.getAbsolutePath(), configFile.getAbsolutePath());

            if (success) {
                // Extract voiceId from modelPath (e.g., "piper-voices/en_US-amy-medium.onnx" ->
                // "en_US-amy-medium")
                String filename = new File(modelPath).getName(); // Get just the filename
                this.currentVoiceId = filename.replace(".onnx", ""); // Remove extension
                this.isLoaded = true;
                Log.i(TAG, "Voice loaded successfully, voiceId: " + this.currentVoiceId);
                return true;
            } else {
                Log.e(TAG, "Failed to load native voice model");
                return false;
            }

        } catch (Exception e) {
            Log.e(TAG, "Exception loading voice", e);
            return false;
        }
    }

    public void unloadVoice() {
        if (isLoaded) {
            nativeUnload();
            this.isLoaded = false;
            this.currentVoiceId = null;
        }
    }

    public String synthesize(long[] phonemeIds) {
        Log.i(TAG, "synthesize called with " + phonemeIds.length + " phonemes");
        if (!isLoaded) {
            Log.e(TAG, "No voice loaded");
            return null;
        }

        return nativeSynthesize(phonemeIds);
    }

    public void speak(long[] phonemeIds, Runnable onComplete) {
        Log.i(TAG, "speak called with " + phonemeIds.length + " phonemes");
        String audioPath = synthesize(phonemeIds);
        if (audioPath != null) {
            File file = new File(audioPath);
            Log.i(TAG, "Audio file generated: " + audioPath + ", size: " + file.length() + " bytes");
            if (file.length() > 100) { // Header is 44 bytes
                playAudio(audioPath, onComplete);
            } else {
                Log.e(TAG, "Audio file is too small, likely empty or just header");
                if (onComplete != null) {
                    onComplete.run();
                }
            }
        } else {
            Log.e(TAG, "Synthesis failed, no audio generated");
            if (onComplete != null) {
                onComplete.run();
            }
        }
    }

    private void playAudio(String path, Runnable onComplete) {
        stop();
        try {
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(path);
            mediaPlayer.prepare();
            mediaPlayer.start();
            Log.i(TAG, "Audio playback started, duration: " + mediaPlayer.getDuration() + "ms");
            mediaPlayer.setOnCompletionListener(mp -> {
                Log.i(TAG, "Audio playback completed");
                mp.release();
                mediaPlayer = null;
                // CRITICAL: Call completion callback AFTER audio finishes
                if (onComplete != null) {
                    onComplete.run();
                }
            });
        } catch (IOException e) {
            Log.e(TAG, "Failed to play audio", e);
            if (onComplete != null) {
                onComplete.run();
            }
        }
    }

    public void stop() {
        if (mediaPlayer != null) {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.stop();
            }
            mediaPlayer.release();
            mediaPlayer = null;
        }
    }

    public boolean isVoiceLoaded() {
        return isLoaded;
    }

    public String getCurrentVoiceId() {
        return currentVoiceId;
    }

    public void cleanup() {
        stop();
        unloadVoice();
    }
}
