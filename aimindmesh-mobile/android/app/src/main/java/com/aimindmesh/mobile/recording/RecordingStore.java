package com.aimindmesh.mobile.recording;

import android.content.Context;
import android.util.Log;

import com.aimindmesh.mobile.utils.AudioEncoder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * On-disk layout of recordings.
 *
 * While recording, a session lives in {@code files/recordings/<sessionId>.wav} plus a
 * {@code <sessionId>.json} sidecar. Finalizing encodes the WAV to AAC into
 * {@code files/meeting-audio/<meetingId>.audio} (where the app looks for meeting audio) and
 * deletes the session files. A session whose files are still there after a crash can be
 * finalized later: that is the recovery path.
 */
final class RecordingStore {
    private static final String TAG = "RecordingStore";
    static final String RECORDINGS_DIR = "recordings";
    static final String MEETING_AUDIO_DIR = "meeting-audio";
    /** Sessions shorter than this hold no useful audio and are deleted instead of offered. */
    private static final long MIN_RECOVERABLE_BYTES = 16_000; // 0.5 s at 16 kHz mono

    static final class Session {
        final String sessionId;
        final String meetingId;
        final long startedAt;
        final int sampleRate;
        String state; // "recording" | "paused" | "stopped"
        /** Moments the user marked, as positions in the recording (ms). */
        final List<Long> bookmarksMs = new CopyOnWriteArrayList<>();

        Session(String sessionId, String meetingId, long startedAt, int sampleRate, String state) {
            this.sessionId = sessionId;
            this.meetingId = meetingId;
            this.startedAt = startedAt;
            this.sampleRate = sampleRate;
            this.state = state;
        }
    }

    static final class FinalizedAudio {
        final String meetingId;
        final String audioPath;
        final String mimeType;
        final long durationMs;
        final long startedAt;
        final List<Long> bookmarksMs;
        /** The recording as 16 kHz WAV when asked to keep it (see finalizeSession), else null. */
        String wavPath;
        /** True when wavPath is a temporary copy the caller deletes, false when it is the meeting audio. */
        boolean wavIsTemporary;

        FinalizedAudio(String meetingId, String audioPath, String mimeType, long durationMs, Session s) {
            this.meetingId = meetingId;
            this.audioPath = audioPath;
            this.mimeType = mimeType;
            this.durationMs = durationMs;
            this.startedAt = s.startedAt;
            this.bookmarksMs = new ArrayList<>(s.bookmarksMs);
        }
    }

    private RecordingStore() {
    }

    static File recordingsDir(Context ctx) {
        return new File(ctx.getFilesDir(), RECORDINGS_DIR);
    }

    static File wavFile(Context ctx, String sessionId) {
        return new File(recordingsDir(ctx), sessionId + ".wav");
    }

    static File metaFile(Context ctx, String sessionId) {
        return new File(recordingsDir(ctx), sessionId + ".json");
    }

    static void save(Context ctx, Session s) throws IOException {
        File dir = recordingsDir(ctx);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create " + dir);
        }
        try {
            JSONObject json = new JSONObject();
            json.put("sessionId", s.sessionId);
            json.put("meetingId", s.meetingId);
            json.put("startedAt", s.startedAt);
            json.put("sampleRate", s.sampleRate);
            json.put("state", s.state);
            JSONArray bookmarks = new JSONArray();
            for (Long ms : s.bookmarksMs) {
                bookmarks.put(ms.longValue());
            }
            json.put("bookmarks", bookmarks);
            File target = metaFile(ctx, s.sessionId);
            File tmp = new File(dir, s.sessionId + ".json.tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(json.toString().getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            if (!tmp.renameTo(target)) {
                throw new IOException("Cannot write " + target);
            }
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        }
    }

    static Session load(Context ctx, String sessionId) throws IOException {
        File file = metaFile(ctx, sessionId);
        byte[] bytes = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) {
            int off = 0;
            while (off < bytes.length) {
                int n = in.read(bytes, off, bytes.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        try {
            JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            Session s = new Session(
                    json.getString("sessionId"),
                    json.getString("meetingId"),
                    json.getLong("startedAt"),
                    json.optInt("sampleRate", RecordingEngine.SAMPLE_RATE),
                    json.optString("state", "stopped"));
            JSONArray bookmarks = json.optJSONArray("bookmarks");
            for (int i = 0; bookmarks != null && i < bookmarks.length(); i++) {
                s.bookmarksMs.add(bookmarks.getLong(i));
            }
            return s;
        } catch (org.json.JSONException e) {
            throw new IOException("Corrupt session metadata " + file, e);
        }
    }

    /** Sessions left on disk, except {@code activeSessionId}. Empty sessions are deleted. */
    static List<Session> listLeftovers(Context ctx, String activeSessionId) {
        List<Session> result = new ArrayList<>();
        File[] files = recordingsDir(ctx).listFiles((d, name) -> name.endsWith(".json"));
        if (files == null) {
            return result;
        }
        for (File f : files) {
            String sessionId = f.getName().substring(0, f.getName().length() - ".json".length());
            if (sessionId.equals(activeSessionId)) {
                continue;
            }
            try {
                Session s = load(ctx, sessionId);
                File wav = wavFile(ctx, sessionId);
                if (!wav.exists() || wav.length() - WavFileWriter.HEADER_BYTES < MIN_RECOVERABLE_BYTES) {
                    delete(ctx, sessionId);
                    continue;
                }
                result.add(s);
            } catch (IOException e) {
                Log.w(TAG, "Skipping unreadable session " + sessionId, e);
            }
        }
        return result;
    }

    static long durationMs(Context ctx, Session s) {
        long data = Math.max(0, wavFile(ctx, s.sessionId).length() - WavFileWriter.HEADER_BYTES);
        return data / 2 * 1000 / s.sampleRate;
    }

    /** Where finalizeSession keeps a recording's WAV for the transcription that follows. */
    static File transcriptionWav(Context ctx, String meetingId) {
        return new File(ctx.getCacheDir(), "transcribe-" + meetingId + ".wav");
    }

    /** Deletes WAVs kept for a transcription that never finished (e.g. the app was killed). */
    static void deleteStaleTranscriptionWavs(Context ctx) {
        File[] files = ctx.getCacheDir().listFiles((d, name) -> name.startsWith("transcribe-") && name.endsWith(".wav"));
        long cutoff = System.currentTimeMillis() - 6L * 60 * 60 * 1000;
        if (files == null) return;
        for (File f : files) {
            if (f.lastModified() < cutoff && f.delete()) {
                Log.i(TAG, "Deleted stale " + f.getName());
            }
        }
    }

    static FinalizedAudio finalizeSession(Context ctx, Session s) throws IOException {
        return finalizeSession(ctx, s, false, null);
    }

    /**
     * Encodes the session's WAV into the meeting audio file and removes the session files.
     * If encoding fails the WAV itself becomes the meeting audio, so no audio is ever lost.
     * With {@code keepWav}, the WAV is moved to {@link #transcriptionWav} instead of deleted,
     * so the transcription can read it without decoding the AAC again.
     */
    static FinalizedAudio finalizeSession(Context ctx, Session s, boolean keepWav, String targetMeetingId) throws IOException {
        // The audio of a meeting deleted meanwhile (here or by sync) goes to a new meeting
        String meetingId = targetMeetingId != null && !targetMeetingId.isEmpty() ? targetMeetingId : s.meetingId;
        File wav = wavFile(ctx, s.sessionId);
        File outDir = new File(ctx.getFilesDir(), MEETING_AUDIO_DIR);
        if (!outDir.exists() && !outDir.mkdirs()) {
            throw new IOException("Cannot create " + outDir);
        }
        File target = new File(outDir, meetingId + ".audio");

        if (target.exists() && !wav.exists()) {
            // A previous finalize got as far as moving the audio into place.
            metaFile(ctx, s.sessionId).delete();
            return new FinalizedAudio(meetingId, target.getAbsolutePath(), sniffMimeType(target),
                    probeDurationMs(target), s);
        }
        if (!wav.exists()) {
            throw new IOException("Recording file missing for session " + s.sessionId);
        }

        long dataBytes = WavFileWriter.repairHeader(wav, s.sampleRate, 1);
        long durationMs = dataBytes / 2 * 1000 / s.sampleRate;

        File tmp = new File(outDir, meetingId + ".audio.tmp");
        long encodeStart = android.os.SystemClock.elapsedRealtime();
        boolean encoded = dataBytes > 0 && AudioEncoder.encodePcmToAac(
                wav, WavFileWriter.HEADER_BYTES, tmp, s.sampleRate, 1, AudioEncoder.DEFAULT_BIT_RATE);

        Log.i(TAG, "Encoded " + durationMs + " ms of audio in "
                + (android.os.SystemClock.elapsedRealtime() - encodeStart) + " ms (ok=" + encoded + ")");
        String mimeType;
        String keptWav = null;
        boolean keptIsTemporary = false;
        if (encoded && replace(tmp, target)) {
            mimeType = "audio/mp4";
            File kept = transcriptionWav(ctx, meetingId);
            if (keepWav && replace(wav, kept)) {
                keptWav = kept.getAbsolutePath();
                keptIsTemporary = true;
            } else {
                wav.delete();
            }
        } else {
            Log.w(TAG, "AAC encoding failed, keeping WAV as meeting audio");
            tmp.delete();
            if (!replace(wav, target)) {
                throw new IOException("Cannot move recording into " + target);
            }
            mimeType = "audio/wav";
            if (keepWav) {
                keptWav = target.getAbsolutePath();
            }
        }
        metaFile(ctx, s.sessionId).delete();
        FinalizedAudio audio = new FinalizedAudio(meetingId, target.getAbsolutePath(), mimeType, durationMs, s);
        audio.wavPath = keptWav;
        audio.wavIsTemporary = keptIsTemporary;
        return audio;
    }

    static void delete(Context ctx, String sessionId) {
        wavFile(ctx, sessionId).delete();
        metaFile(ctx, sessionId).delete();
    }

    private static boolean replace(File from, File to) {
        if (to.exists() && !to.delete()) {
            return false;
        }
        return from.renameTo(to);
    }

    private static long probeDurationMs(File file) {
        android.media.MediaMetadataRetriever retriever = new android.media.MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            String d = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
            return d != null ? Long.parseLong(d) : 0;
        } catch (Exception e) {
            return 0;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
            }
        }
    }

    private static String sniffMimeType(File file) {
        byte[] magic = new byte[4];
        try (FileInputStream in = new FileInputStream(file)) {
            if (in.read(magic) == 4 && magic[0] == 'R' && magic[1] == 'I' && magic[2] == 'F' && magic[3] == 'F') {
                return "audio/wav";
            }
        } catch (IOException ignored) {
        }
        return "audio/mp4";
    }
}
