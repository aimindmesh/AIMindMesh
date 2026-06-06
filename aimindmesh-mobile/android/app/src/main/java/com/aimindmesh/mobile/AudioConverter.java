package com.aimindmesh.mobile;

import android.util.Base64;
import android.util.Log;

import com.aimindmesh.mobile.utils.AudioDecoder;
import com.aimindmesh.mobile.utils.AudioEncoder;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;

@CapacitorPlugin(name = "AudioConverter")
public class AudioConverter extends Plugin {
    private static final String TAG = "AudioConverter";

    // State for active recording session
    private File activePcmFile = null;
    private FileOutputStream activeFos = null;
    private int activeSampleRate = 16000;
    private int activeChannels = 1;

    @PluginMethod
    public void startWriting(PluginCall call) {
        try {
            cleanupActiveSession();

            activeSampleRate = call.getInt("sampleRate", 16000);
            activeChannels = call.getInt("channels", 1);

            activePcmFile = File.createTempFile("streaming_rec", ".pcm", getContext().getCacheDir());
            activeFos = new FileOutputStream(activePcmFile);

            call.resolve();
        } catch (IOException e) {
            Log.e(TAG, "Failed to start writing: " + e.getMessage(), e);
            call.reject("Failed to start writing: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String data = call.getString("data");
        if (data == null || activeFos == null) {
            call.reject("No active recording or data missing");
            return;
        }

        try {
            byte[] pcmBytes = Base64.decode(data, Base64.DEFAULT);
            activeFos.write(pcmBytes);
            call.resolve();
        } catch (IOException e) {
            Log.e(TAG, "Failed to write chunk", e);
            call.reject("Failed to write chunk: " + e.getMessage());
        }
    }

    @PluginMethod
    public void finishWriting(PluginCall call) {
        if (activeFos == null || activePcmFile == null) {
            call.reject("No active recording");
            return;
        }

        try {
            activeFos.close();
            activeFos = null;

            File outputFile = File.createTempFile("meeting_recording", ".m4a", getContext().getFilesDir());

            // Encode PCM file to M4A
            boolean success = AudioEncoder.encodePcmFileToAac(activePcmFile, outputFile, activeSampleRate,
                    activeChannels);

            if (success) {
                JSObject result = new JSObject();
                result.put("filePath", outputFile.getAbsolutePath());
                result.put("durationMs", (activePcmFile.length() / 2 * 1000) / activeSampleRate);

                activePcmFile.delete();
                activePcmFile = null;

                call.resolve(result);
            } else {
                call.reject("Encoding failed");
            }

        } catch (Exception e) {
            Log.e(TAG, "Failed to finish writing", e);
            call.reject("Failed to finish writing: " + e.getMessage());
        } finally {
            cleanupActiveSession();
        }
    }

    @PluginMethod
    public void decodeM4AToWav(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }

        new Thread(() -> {
            try {
                File inputFile = new File(filePath);
                if (!inputFile.exists()) {
                    call.reject("Input file not found");
                    return;
                }

                File outputFile = new File(getContext().getCacheDir(),
                        "decoded_" + System.currentTimeMillis() + ".wav");
                if (AudioDecoder.decodeToWav(inputFile, outputFile)) {
                    JSObject result = new JSObject();
                    result.put("filePath", outputFile.getAbsolutePath());
                    call.resolve(result);
                } else {
                    call.reject("Decoding failed");
                }
            } catch (Exception e) {
                Log.e(TAG, "Decoding exception", e);
                call.reject("Decoding exception: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void convertToM4A(PluginCall call) {
        String base64Audio = call.getString("audioData");
        String mimeType = call.getString("mimeType", "audio/webm");

        if (base64Audio == null || base64Audio.isEmpty()) {
            call.reject("audioData is required");
            return;
        }

        new Thread(() -> {
            try {
                byte[] audioBytes = Base64.decode(base64Audio, Base64.DEFAULT);
                File tempInput = File.createTempFile("audio_input", getExtension(mimeType), getContext().getCacheDir());
                FileOutputStream fos = new FileOutputStream(tempInput);
                fos.write(audioBytes);
                fos.close();

                File tempOutput = File.createTempFile("audio_output", ".m4a", getContext().getCacheDir());
                if (AudioDecoder.transcode(tempInput.getAbsolutePath(), tempOutput.getAbsolutePath())) {
                    FileInputStream fis = new FileInputStream(tempOutput);
                    byte[] outputBytes = new byte[(int) tempOutput.length()];
                    fis.read(outputBytes);
                    fis.close();

                    JSObject result = new JSObject();
                    result.put("success", true);
                    result.put("audioData", Base64.encodeToString(outputBytes, Base64.NO_WRAP));
                    result.put("mimeType", "audio/mp4");
                    call.resolve(result);
                } else {
                    call.reject("Transcoding failed");
                }
                tempInput.delete();
                tempOutput.delete();
            } catch (Exception e) {
                Log.e(TAG, "Conversion error", e);
                call.reject("Conversion failed: " + e.getMessage());
            }
        }).start();
    }

    private void cleanupActiveSession() {
        if (activeFos != null) {
            try {
                activeFos.close();
            } catch (IOException e) {
            }
            activeFos = null;
        }
    }

    private String getExtension(String mimeType) {
        if (mimeType.contains("webm"))
            return ".webm";
        if (mimeType.contains("ogg"))
            return ".ogg";
        if (mimeType.contains("mp4") || mimeType.contains("m4a"))
            return ".m4a";
        if (mimeType.contains("wav"))
            return ".wav";
        return ".audio";
    }
}
