package com.aimindmesh.piper;

import android.content.Context;
import android.media.MediaPlayer;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

// Native Piper implementation using ONNX Runtime
public class PiperSynthesizer {
    private static final String TAG = "PiperSynthesizer";
    private Context context;
    private android.media.AudioManager audioManager;
    private volatile String currentVoiceId;
    private volatile boolean isLoaded = false;

    // The native ORT session is a global: load/unload while another thread synthesizes freed
    // it mid-inference, so every native call holds this lock.
    private final Object nativeLock = new Object();

    // Playback state, touched from the speak threads, the plugin thread (stop) and the main
    // looper (completion callbacks).
    private final Object playerLock = new Object();
    private MediaPlayer mediaPlayer;
    private Runnable pendingCompletion;
    private File currentFile;

    // Bumped by stop(): a speak() that was still synthesizing must not start playing afterwards.
    private final AtomicInteger generation = new AtomicInteger();

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

    private native String nativeSynthesize(long[] phonemeIds, String outputPath);

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
            boolean success;
            synchronized (nativeLock) {
                success = nativeLoadVoice(modelFile.getAbsolutePath(), configFile.getAbsolutePath());
            }

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
        synchronized (nativeLock) {
            if (isLoaded) {
                nativeUnload();
                this.isLoaded = false;
                this.currentVoiceId = null;
            }
        }
    }

    public String synthesize(long[] phonemeIds) {
        Log.i(TAG, "synthesize called with " + phonemeIds.length + " phonemes");
        File out = new File(context.getCacheDir(), "piper_output.wav");
        return synthesizeTo(phonemeIds, out) ? out.getAbsolutePath() : null;
    }

    private boolean synthesizeTo(long[] phonemeIds, File out) {
        synchronized (nativeLock) {
            if (!isLoaded) {
                Log.e(TAG, "No voice loaded");
                return false;
            }
            return nativeSynthesize(phonemeIds, out.getAbsolutePath()) != null;
        }
    }

    public void speak(long[] phonemeIds, Runnable onComplete) {
        Log.i(TAG, "speak called with " + phonemeIds.length + " phonemes");
        int gen = generation.get();
        File out;
        try {
            // One file per utterance: a fixed path was overwritten while MediaPlayer still read it
            out = File.createTempFile("piper_", ".wav", context.getCacheDir());
        } catch (IOException e) {
            Log.e(TAG, "Cannot create audio file", e);
            onComplete.run();
            return;
        }

        if (!synthesizeTo(phonemeIds, out) || out.length() <= 100) { // Header is 44 bytes
            Log.e(TAG, "Synthesis failed or produced no audio (" + out.length() + " bytes)");
            out.delete();
            onComplete.run();
            return;
        }
        Log.i(TAG, "Audio file generated: " + out.getAbsolutePath() + ", size: " + out.length() + " bytes");
        playAudio(out, onComplete, gen);
    }

    private void playAudio(File file, Runnable onComplete, int gen) {
        Runnable finished = null;
        Runnable replaced = null;
        synchronized (playerLock) {
            if (gen != generation.get()) {
                // stop() arrived while synthesizing: report done without playing
                file.delete();
                finished = onComplete;
            } else {
                replaced = detachPlayerLocked();
                MediaPlayer mp = new MediaPlayer();
                try {
                    mp.setDataSource(file.getAbsolutePath());
                    mp.setOnCompletionListener(this::onPlaybackFinished);
                    mp.setOnErrorListener((player, what, extra) -> {
                        Log.e(TAG, "Playback error " + what + "/" + extra);
                        onPlaybackFinished(player);
                        return true;
                    });
                    mp.prepare();
                    mediaPlayer = mp;
                    pendingCompletion = onComplete;
                    currentFile = file;
                    mp.start();
                    Log.i(TAG, "Audio playback started, duration: " + mp.getDuration() + "ms");
                } catch (IOException | RuntimeException e) {
                    Log.e(TAG, "Failed to play audio", e);
                    if (mediaPlayer == mp) {
                        mediaPlayer = null;
                        pendingCompletion = null;
                        currentFile = null;
                    }
                    mp.release();
                    file.delete();
                    finished = onComplete;
                }
            }
        }
        // Callbacks resolve plugin calls: run them outside the lock
        if (replaced != null) replaced.run();
        if (finished != null) finished.run();
    }

    private void onPlaybackFinished(MediaPlayer mp) {
        Runnable done;
        synchronized (playerLock) {
            if (mp != mediaPlayer) {
                return; // already detached by stop() or a newer utterance
            }
            Log.i(TAG, "Audio playback completed");
            done = detachPlayerLocked();
        }
        // CRITICAL: Call completion callback AFTER audio finishes
        if (done != null) done.run();
    }

    /** Stops and releases the current player; returns its pending completion (to run unlocked). */
    private Runnable detachPlayerLocked() {
        MediaPlayer mp = mediaPlayer;
        Runnable done = pendingCompletion;
        mediaPlayer = null;
        pendingCompletion = null;
        if (mp != null) {
            try {
                if (mp.isPlaying()) {
                    mp.stop();
                }
            } catch (IllegalStateException e) {
                Log.w(TAG, "MediaPlayer stop in invalid state", e);
            }
            mp.release();
        }
        if (currentFile != null) {
            currentFile.delete();
            currentFile = null;
        }
        return done;
    }

    public void stop() {
        generation.incrementAndGet();
        Runnable done;
        synchronized (playerLock) {
            done = detachPlayerLocked();
        }
        // Resolve the interrupted speak call instead of leaving its JS promise pending forever
        if (done != null) done.run();
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
