package com.aimindmesh.mobile;

import android.util.Base64;
import android.util.Log;

import com.aimindmesh.mobile.meeting.MeetingRecordingFiles;
import com.aimindmesh.mobile.utils.AudioDecoder;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "AudioConverter")
public class AudioConverter extends Plugin {
    private static final String TAG = "AudioConverter";

    // State for active recording session
    private File activePcmFile = null;
    private FileOutputStream activeFos = null;
    private int activeSampleRate = 16000;
    private int activeChannels = 1;
    /** Recordings being encoded (finish or recovery): never listed or recovered twice */
    private final Set<String> busyPaths = Collections.synchronizedSet(new HashSet<>());

    @PluginMethod
    public void startWriting(PluginCall call) {
        try {
            closeActiveSession();

            activeSampleRate = call.getInt("sampleRate", 16000);
            activeChannels = Math.max(1, call.getInt("channels", 1));
            long startedAt = call.getData().optLong("startedAt", System.currentTimeMillis());

            // Named with the meeting it belongs to: a recording cut short by a kill is recovered from it
            activePcmFile = MeetingRecordingFiles.newRecordingFile(getContext(), startedAt,
                    call.getString("meetingId", ""), activeSampleRate, activeChannels);
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

        // Detach the session here, after every queued writeChunk, and encode on a worker thread:
        // encoding a long meeting on the plugin thread blocked every other plugin call meanwhile.
        final File pcmFile = activePcmFile;
        final FileOutputStream fos = activeFos;
        final int sampleRate = activeSampleRate;
        final int channels = Math.max(1, activeChannels);
        activePcmFile = null;
        activeFos = null;

        final String busyKey = pcmFile.getAbsolutePath();
        busyPaths.add(busyKey);

        new Thread(() -> {
            try {
                fos.close();
                long durationMs = MeetingRecordingFiles.durationMs(pcmFile.length(), sampleRate, channels);
                File outputFile = MeetingRecordingFiles.encode(getContext(), pcmFile, sampleRate, channels);
                pcmFile.delete();

                JSObject result = new JSObject();
                result.put("filePath", outputFile.getAbsolutePath());
                result.put("durationMs", durationMs);
                call.resolve(result);
            } catch (Exception e) {
                // The PCM stays where it is: it is recovered at the next start
                Log.e(TAG, "Failed to finish writing", e);
                call.reject("Failed to finish writing: " + e.getMessage());
            } finally {
                busyPaths.remove(busyKey);
            }
        }).start();
    }

    private boolean isInUse(File file) {
        String path = file.getAbsolutePath();
        return busyPaths.contains(path) || (activePcmFile != null && activePcmFile.getAbsolutePath().equals(path));
    }

    /** Recordings left behind by an app killed while recording (the one in progress is excluded). */
    @PluginMethod
    public void listOrphanRecordings(PluginCall call) {
        JSArray recordings = new JSArray();
        for (MeetingRecordingFiles.Info info : MeetingRecordingFiles.list(getContext())) {
            if (isInUse(info.file)) continue;
            JSObject item = new JSObject();
            item.put("path", info.file.getAbsolutePath());
            item.put("meetingId", info.meetingId);
            item.put("startedAt", info.startedAt);
            item.put("durationMs", info.durationMs());
            item.put("sampleRate", info.sampleRate);
            item.put("channels", info.channels);
            recordings.put(item);
        }
        JSObject result = new JSObject();
        result.put("recordings", recordings);
        call.resolve(result);
    }

    /** Encodes an orphan recording off the plugin thread; the PCM is deleted only once encoded. */
    @PluginMethod
    public void recoverRecording(PluginCall call) {
        final MeetingRecordingFiles.Info info = orphanFromCall(call);
        if (info == null) return;
        final String busyKey = info.file.getAbsolutePath();
        busyPaths.add(busyKey);

        new Thread(() -> {
            try {
                long durationMs = info.durationMs();
                File outputFile = MeetingRecordingFiles.encode(getContext(), info.file, info.sampleRate, info.channels);
                info.file.delete();

                JSObject result = new JSObject();
                result.put("filePath", outputFile.getAbsolutePath());
                result.put("durationMs", durationMs);
                call.resolve(result);
            } catch (Exception e) {
                // Kept for the next attempt
                Log.e(TAG, "Recovery failed", e);
                call.reject("Recovery failed: " + e.getMessage());
            } finally {
                busyPaths.remove(busyKey);
            }
        }).start();
    }

    /** Deletes an orphan recording with no audio worth keeping. */
    @PluginMethod
    public void discardRecording(PluginCall call) {
        MeetingRecordingFiles.Info info = orphanFromCall(call);
        if (info == null) return;
        info.file.delete();
        call.resolve();
    }

    /** The orphan recording named by the call's "path", or null after rejecting the call. */
    private MeetingRecordingFiles.Info orphanFromCall(PluginCall call) {
        String path = call.getString("path");
        File file = path == null ? null : new File(path);
        MeetingRecordingFiles.Info info = file != null && file.exists() ? MeetingRecordingFiles.describe(getContext(), file) : null;
        if (info == null) {
            call.reject("Not a meeting recording: " + path);
            return null;
        }
        if (isInUse(info.file)) {
            call.reject("Recording in use");
            return null;
        }
        return info;
    }

    @PluginMethod
    public void decodeM4AToWav(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }

        // Filesystem.getUri() returns file:// URIs: new File(uri) never existed
        final String path = filePath.startsWith("file://") ? android.net.Uri.parse(filePath).getPath() : filePath;

        new Thread(() -> {
            try {
                File inputFile = new File(path);
                if (!inputFile.exists()) {
                    call.reject("Input file not found");
                    return;
                }

                // Only the latest decode is in use: older ones (100+ MB per hour) piled up in the cache
                File cacheDir = getContext().getCacheDir();
                File[] previous = cacheDir.listFiles((dir, name) -> name.startsWith("decoded_") && name.endsWith(".wav"));
                if (previous != null) {
                    for (File old : previous) {
                        old.delete();
                    }
                }

                File outputFile = new File(cacheDir,
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

    /** Closes a session that was never finished: its PCM stays on disk and is recovered later. */
    private void closeActiveSession() {
        if (activeFos != null) {
            try {
                activeFos.close();
            } catch (IOException e) {
            }
            activeFos = null;
        }
        activePcmFile = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeActiveSession();
        super.handleOnDestroy();
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
