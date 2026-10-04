package com.aimindmesh.mobile.meeting;

import android.content.Context;
import android.util.Log;

import com.aimindmesh.mobile.utils.AudioEncoder;
import com.aimindmesh.mobile.utils.WavHelper;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Raw PCM recordings of older app versions (before the native recorder, recording/), left by an
 * app killed while recording: listed and recovered at the next start. Their name carries what
 * recovery needs: rec_<startedAt>_<meetingId>_<sampleRate>_<channels>.pcm
 */
public final class MeetingRecordingFiles {
    private static final String TAG = "MeetingRecordingFiles";
    private static final String DIR = "meeting-pcm";
    private static final Pattern NAME = Pattern.compile("^rec_(\\d+)_([A-Za-z0-9-]+)_(\\d+)_(\\d+)\\.pcm$");
    /** Name used by older versions, in the cache dir, without metadata */
    private static final Pattern LEGACY_NAME = Pattern.compile("^streaming_rec.*\\.pcm$");

    private MeetingRecordingFiles() {
    }

    public static final class Info {
        public final File file;
        public final long startedAt;
        /** Empty when the recording was not tied to a meeting */
        public final String meetingId;
        public final int sampleRate;
        public final int channels;

        Info(File file, long startedAt, String meetingId, int sampleRate, int channels) {
            this.file = file;
            this.startedAt = startedAt;
            this.meetingId = meetingId;
            this.sampleRate = sampleRate;
            this.channels = channels;
        }

        public long durationMs() {
            return MeetingRecordingFiles.durationMs(file.length(), sampleRate, channels);
        }
    }

    public static long durationMs(long bytes, int sampleRate, int channels) {
        return (bytes / 2 / Math.max(1, channels) * 1000) / Math.max(1, sampleRate);
    }

    public static File directory(Context context) {
        File dir = new File(context.getFilesDir(), DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "Could not create " + dir.getAbsolutePath());
        }
        return dir;
    }

    /** Metadata of a recording file, or null when the file is not one. */
    public static Info describe(Context context, File file) {
        File parent = file.getParentFile();
        if (parent == null) return null;
        String name = file.getName();
        if (parent.getAbsolutePath().equals(directory(context).getAbsolutePath())) {
            Matcher m = NAME.matcher(name);
            if (!m.matches()) return null;
            try {
                String id = m.group(2);
                return new Info(file, Long.parseLong(m.group(1)), "none".equals(id) ? "" : id,
                        Integer.parseInt(m.group(3)), Integer.parseInt(m.group(4)));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        if (parent.getAbsolutePath().equals(context.getCacheDir().getAbsolutePath()) && LEGACY_NAME.matcher(name).matches()) {
            long duration = durationMs(file.length(), 16000, 1);
            return new Info(file, Math.max(0, file.lastModified() - duration), "", 16000, 1);
        }
        return null;
    }

    /** Every recording file on disk (in progress or left behind by a killed app). */
    public static List<Info> list(Context context) {
        List<Info> result = new ArrayList<>();
        addAll(context, directory(context).listFiles(), result);
        addAll(context, context.getCacheDir().listFiles(), result);
        return result;
    }

    private static void addAll(Context context, File[] files, List<Info> into) {
        if (files == null) return;
        for (File file : files) {
            Info info = describe(context, file);
            if (info != null) into.add(info);
        }
    }

    /**
     * Encodes a recording to AAC (.m4a) in the files dir. When the encoder fails the audio is kept
     * as WAV; an exception means neither could be written and the PCM must be kept.
     */
    public static File encode(Context context, File pcmFile, int sampleRate, int channels) throws IOException {
        File filesDir = context.getFilesDir();
        File m4a = File.createTempFile("meeting_recording", ".m4a", filesDir);
        if (AudioEncoder.encodePcmFileToAac(pcmFile, m4a, sampleRate, channels)) {
            return m4a;
        }
        Log.w(TAG, "AAC encoding failed, keeping the recording as WAV");
        m4a.delete();
        return pcmToWav(pcmFile, filesDir, sampleRate, channels);
    }

    /** Wraps raw PCM in a WAV header (streamed: recordings can be hundreds of MB). */
    private static File pcmToWav(File pcmFile, File dir, int sampleRate, int channels) throws IOException {
        File wavFile = File.createTempFile("meeting_recording", ".wav", dir);
        try {
            try (FileInputStream in = new FileInputStream(pcmFile); FileOutputStream out = new FileOutputStream(wavFile)) {
                out.write(new byte[44]); // header written below, once the size is known
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                }
            }
            long dataLength = pcmFile.length();
            WavHelper.updateWavHeader(wavFile, dataLength, dataLength + 36, sampleRate, channels,
                    (long) sampleRate * channels * 2);
            return wavFile;
        } catch (IOException e) {
            wavFile.delete();
            throw e;
        }
    }
}
