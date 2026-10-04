package com.aimindmesh.mobile;

import android.util.Base64;
import android.util.Log;

import com.aimindmesh.mobile.meeting.MeetingRecordingFiles;
import com.aimindmesh.mobile.utils.AudioDecoder;
import com.aimindmesh.mobile.utils.AudioEncoder;
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

    /** Recordings being encoded by a recovery: never listed or recovered twice */
    private final Set<String> busyPaths = Collections.synchronizedSet(new HashSet<>());

    private boolean isInUse(File file) {
        String path = file.getAbsolutePath();
        return busyPaths.contains(path);
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

                File cacheDir = getContext().getCacheDir();
                deleteStaleDecodes(cacheDir);

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

    /**
     * Decoded WAVs (100+ MB per hour) belong to the job that asked for them, which deletes its
     * own: only those left by a job that never finished (app killed) are removed here. Removing
     * every other decode broke jobs running at the same time.
     */
    private static void deleteStaleDecodes(File cacheDir) {
        long cutoff = System.currentTimeMillis() - STALE_DECODE_MS;
        File[] previous = cacheDir.listFiles((dir, name) ->
                (name.startsWith("decoded_") || name.startsWith("import_")) && name.endsWith(".wav"));
        if (previous == null) return;
        for (File old : previous) {
            if (old.lastModified() < cutoff) {
                old.delete();
            }
        }
    }

    private static final long STALE_DECODE_MS = 6 * 60 * 60 * 1000L;

    /**
     * Imports an audio file (M4A, MP3, WAV, OGG, AAC, FLAC...): decodes it to a 16 kHz mono WAV in
     * the cache (for transcription; the caller deletes it) and, with a meetingId, encodes the
     * meeting's audio file meeting-audio/{id}.audio as AAC.
     * Returns { wavPath, m4aPath?, durationMs }.
     */
    @PluginMethod
    public void decodeAudioFile(PluginCall call) {
        String filePath = call.getString("filePath");
        String meetingId = call.getString("meetingId");
        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }
        final String path = filePath.startsWith("file://") ? android.net.Uri.parse(filePath).getPath() : filePath;

        new Thread(() -> {
            try {
                File inputFile = new File(path);
                if (!inputFile.exists()) {
                    call.reject("Input file not found");
                    return;
                }
                File cacheDir = getContext().getCacheDir();
                deleteStaleDecodes(cacheDir);
                File wav = new File(cacheDir, "import_" + System.currentTimeMillis() + ".wav");
                if (!AudioDecoder.decodeToWav(inputFile, wav)) {
                    call.reject("Failed to decode audio");
                    return;
                }
                JSObject result = new JSObject();
                result.put("wavPath", wav.getAbsolutePath());
                result.put("durationMs", Math.max(0, wav.length() - 44) / 2 * 1000 / 16000);

                if (meetingId != null && !meetingId.isEmpty()) {
                    File dir = new File(getContext().getFilesDir(), "meeting-audio");
                    if (!dir.exists() && !dir.mkdirs()) {
                        throw new IOException("Cannot create " + dir);
                    }
                    File tmp = new File(dir, meetingId + ".audio.tmp");
                    File m4a = new File(dir, meetingId + ".audio");
                    if (AudioEncoder.encodePcmToAac(wav, 44, tmp, 16000, 1, AudioEncoder.DEFAULT_BIT_RATE)
                            && tmp.renameTo(m4a)) {
                        result.put("m4aPath", m4a.getAbsolutePath());
                    } else {
                        tmp.delete();
                        Log.w(TAG, "Imported audio could not be encoded: kept as WAV only");
                    }
                }
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "decodeAudioFile error", e);
                call.reject("Audio decoding failed: " + e.getMessage());
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
