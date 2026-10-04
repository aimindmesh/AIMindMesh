package com.aimindmesh.mobile.recording;

import android.Manifest;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * JS API of {@link RecordingEngine}: start/pause/resume/stop a meeting recording, turn a stopped
 * or interrupted session into the meeting audio file, and stream levels/PCM to the web layer.
 */
@CapacitorPlugin(name = "MeetingRecorder", permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class MeetingRecorderPlugin extends Plugin implements RecordingEngine.Listener {
    private static final String TAG = "MeetingRecorderPlugin";

    private RecordingEngine engine;
    // Start/stop must not queue behind a long AAC encode, so they get their own thread.
    private final ExecutorService control = Executors.newSingleThreadExecutor();
    private final ExecutorService files = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        engine = RecordingEngine.get(getContext());
        engine.setListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        // The engine keeps recording without an activity; a new plugin instance re-attaches.
        engine.clearListener(this);
        control.shutdown();
        files.shutdown();
    }

    @PluginMethod
    public void start(PluginCall call) {
        boolean needsMic = getPermissionState("microphone") != PermissionState.GRANTED;
        boolean askNotifications = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") == PermissionState.PROMPT;
        if (needsMic || askNotifications) {
            String[] aliases = askNotifications
                    ? new String[] { "microphone", "notifications" }
                    : new String[] { "microphone" };
            requestPermissionForAliases(aliases, call, "startAfterPermissions");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void startAfterPermissions(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission denied", "PERMISSION_DENIED");
            return;
        }
        doStart(call);
    }

    private void doStart(PluginCall call) {
        String meetingId = call.getString("meetingId");
        if (meetingId == null || meetingId.isEmpty()) {
            call.reject("meetingId is required");
            return;
        }
        boolean streamPcm = Boolean.TRUE.equals(call.getBoolean("streamPcm", false));
        control.execute(() -> {
            try {
                RecordingStore.Session s = engine.start(meetingId, streamPcm);
                JSObject ret = new JSObject();
                ret.put("sessionId", s.sessionId);
                ret.put("meetingId", s.meetingId);
                ret.put("startedAt", s.startedAt);
                // The file being written, for transcription while recording
                ret.put("wavPath", RecordingStore.wavFile(getContext(), s.sessionId).getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                Log.e(TAG, "Cannot start recording", e);
                call.reject("Cannot start recording: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        control.execute(() -> {
            engine.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        control.execute(() -> {
            engine.resume();
            call.resolve();
        });
    }

    /** Marks the current moment of the recording; resolves { ms } (its position in the recording). */
    @PluginMethod
    public void addBookmark(PluginCall call) {
        long ms = engine.addBookmark();
        if (ms < 0) {
            call.reject("Not recording");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ms", ms);
        call.resolve(ret);
    }

    private static JSArray toJsArray(List<Long> values) {
        JSArray array = new JSArray();
        for (Long v : values) {
            array.put(v.longValue());
        }
        return array;
    }

    /** Stops capturing. The audio stays in the session WAV until finalizeRecording. */
    @PluginMethod
    public void stop(PluginCall call) {
        control.execute(() -> {
            RecordingStore.Session s = engine.stop();
            if (s == null) {
                call.reject("No recording to stop");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("sessionId", s.sessionId);
            ret.put("meetingId", s.meetingId);
            ret.put("startedAt", s.startedAt);
            ret.put("durationMs", engine.getDurationMs());
            call.resolve(ret);
        });
    }

    /**
     * Encodes a stopped or interrupted session into files/meeting-audio/{meetingId}.audio and
     * removes the session files. Used both after a normal stop and to recover after a crash.
     * {@code targetMeetingId} gives the audio to another meeting (the session's was deleted).
     */
    @PluginMethod
    public void finalizeRecording(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("sessionId is required");
            return;
        }
        if (isActive(sessionId)) {
            call.reject("The session is still recording");
            return;
        }
        boolean keepWav = Boolean.TRUE.equals(call.getBoolean("keepWav", false));
        String targetMeetingId = call.getString("targetMeetingId");
        files.execute(() -> {
            try {
                RecordingStore.FinalizedAudio audio = RecordingStore.finalizeSession(
                        getContext(), RecordingStore.load(getContext(), sessionId), keepWav, targetMeetingId);
                JSObject ret = new JSObject();
                ret.put("meetingId", audio.meetingId);
                ret.put("audioPath", audio.audioPath);
                ret.put("mimeType", audio.mimeType);
                ret.put("durationMs", audio.durationMs);
                ret.put("startedAt", audio.startedAt);
                ret.put("bookmarks", toJsArray(audio.bookmarksMs));
                if (audio.wavPath != null) {
                    ret.put("wavPath", audio.wavPath);
                    ret.put("wavIsTemporary", audio.wavIsTemporary);
                }
                call.resolve(ret);
            } catch (IOException e) {
                Log.e(TAG, "Cannot finalize " + sessionId, e);
                call.reject("Cannot save the recording: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        RecordingStore.Session s = engine.getSession();
        JSObject ret = new JSObject();
        ret.put("state", engine.getState().name().toLowerCase(java.util.Locale.ROOT));
        if (s != null) {
            ret.put("sessionId", s.sessionId);
            ret.put("meetingId", s.meetingId);
            ret.put("startedAt", s.startedAt);
            ret.put("durationMs", engine.getDurationMs());
            ret.put("streamPcm", engine.isStreamingPcm());
            ret.put("bookmarks", toJsArray(s.bookmarksMs));
            // The file being written, for transcription while recording
            ret.put("wavPath", RecordingStore.wavFile(getContext(), s.sessionId).getAbsolutePath());
        }
        call.resolve(ret);
    }

    /** Sessions left on disk by a crash or a kill, which can be finalized or discarded. */
    @PluginMethod
    public void listRecoverable(PluginCall call) {
        files.execute(() -> {
            RecordingStore.deleteStaleTranscriptionWavs(getContext());
            RecordingStore.Session active = engine.getSession();
            List<RecordingStore.Session> sessions = RecordingStore.listLeftovers(
                    getContext(), active != null ? active.sessionId : null);
            JSArray list = new JSArray();
            for (RecordingStore.Session s : sessions) {
                JSObject o = new JSObject();
                o.put("sessionId", s.sessionId);
                o.put("meetingId", s.meetingId);
                o.put("startedAt", s.startedAt);
                o.put("durationMs", RecordingStore.durationMs(getContext(), s));
                o.put("bookmarks", toJsArray(s.bookmarksMs));
                list.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("sessions", list);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void discard(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("sessionId is required");
            return;
        }
        if (isActive(sessionId)) {
            call.reject("The session is still recording");
            return;
        }
        files.execute(() -> {
            RecordingStore.delete(getContext(), sessionId);
            call.resolve();
        });
    }

    private boolean isActive(String sessionId) {
        RecordingStore.Session active = engine.getSession();
        return active != null && active.sessionId.equals(sessionId);
    }

    // ---- RecordingEngine.Listener (called from the engine's threads) ----

    @Override
    public void onLevel(float level) {
        JSObject ret = new JSObject();
        ret.put("level", level);
        notifyListeners("level", ret);
    }

    @Override
    public void onPcm(short[] samples, int length, long sampleOffset) {
        ByteBuffer bytes = ByteBuffer.allocate(length * 2).order(ByteOrder.LITTLE_ENDIAN);
        bytes.asShortBuffer().put(samples, 0, length);
        JSObject ret = new JSObject();
        ret.put("data", Base64.encodeToString(bytes.array(), Base64.NO_WRAP));
        ret.put("offset", sampleOffset);
        notifyListeners("pcm", ret);
    }

    @Override
    public void onStateChanged(RecordingEngine.State state, String reason) {
        JSObject ret = new JSObject();
        ret.put("state", state.name().toLowerCase(java.util.Locale.ROOT));
        ret.put("reason", reason);
        notifyListeners("state", ret);
    }

    @Override
    public void onError(String message) {
        JSObject ret = new JSObject();
        ret.put("message", message);
        notifyListeners("error", ret);
    }

    @Override
    public void onBookmark(long ms) {
        JSObject ret = new JSObject();
        ret.put("ms", ms);
        notifyListeners("bookmark", ret);
    }
}
