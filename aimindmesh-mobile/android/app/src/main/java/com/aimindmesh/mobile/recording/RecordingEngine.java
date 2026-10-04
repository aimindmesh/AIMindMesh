package com.aimindmesh.mobile.recording;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import android.util.Log;

import com.aimindmesh.vosk.VoskAudioBridge;

import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * The single microphone capture of the app.
 *
 * A capture thread reads 16 kHz mono PCM and writes it straight to the session WAV file: that
 * path never waits on anything else. A consumer thread then hands the same audio to the live
 * recognizer (via {@link VoskAudioBridge} and {@link RecordingAudioTaps}, e.g. Voxtral) and to
 * the web layer (levels and optional PCM), so a
 * slow recognizer can only delay transcription, never lose recorded audio.
 *
 * Everything shares one clock: the number of samples written to the file. Pausing stops the
 * microphone and nothing is written meanwhile, so the file and all timestamps exclude pauses.
 *
 * The engine is a process-wide singleton and outlives the activity, kept alive by
 * {@link RecordingService} while a session is active.
 */
public final class RecordingEngine {
    private static final String TAG = "RecordingEngine";

    public static final int SAMPLE_RATE = 16000;
    private static final int READ_SAMPLES = 1600;           // 100 ms per read
    private static final int PCM_EVENT_SAMPLES = 4000;      // 250 ms per "pcm" event to the web layer
    private static final int MAX_PENDING_CHUNKS = 3000;     // 5 min of audio waiting for consumers
    private static final long CONSUMER_DRAIN_TIMEOUT_MS = 5000;

    public enum State { IDLE, RECORDING, PAUSED }

    public interface Listener {
        void onLevel(float level);

        /** {@code samples} is only valid during the call. */
        void onPcm(short[] samples, int length, long sampleOffset);

        void onStateChanged(State state, String reason);

        void onError(String message);

        /** A moment was marked, at {@code ms} into the recording. */
        void onBookmark(long ms);
    }

    private static final class Chunk {
        final short[] samples;
        final long offset;

        Chunk(short[] samples, long offset) {
            this.samples = samples;
            this.offset = offset;
        }
    }

    private static RecordingEngine instance;

    public static synchronized RecordingEngine get(Context context) {
        if (instance == null) {
            instance = new RecordingEngine(context.getApplicationContext());
        }
        return instance;
    }

    private final Context appContext;
    private final Object pauseLock = new Object();
    private final LinkedBlockingQueue<Chunk> pending = new LinkedBlockingQueue<>(MAX_PENDING_CHUNKS);

    private volatile State state = State.IDLE;
    private volatile Listener listener;
    private volatile boolean running;
    private volatile boolean pauseRequested;
    private volatile boolean captureFinished;
    private volatile boolean streamPcm;
    private volatile long samplesWritten;
    private volatile long drainDeadline;

    private volatile RecordingStore.Session session;
    private RecordingStore.Session lastStopped;
    private Thread captureThread;
    private Thread consumerThread;

    private RecordingEngine(Context appContext) {
        this.appContext = appContext;
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void clearListener(Listener l) {
        if (listener == l) {
            listener = null;
        }
    }

    public State getState() {
        return state;
    }

    public RecordingStore.Session getSession() {
        return session;
    }

    public boolean isStreamingPcm() {
        return streamPcm;
    }

    /** Recorded audio so far, excluding pauses. */
    public long getDurationMs() {
        return samplesWritten * 1000 / SAMPLE_RATE;
    }

    public synchronized RecordingStore.Session start(String meetingId, boolean streamPcm) throws Exception {
        if (state != State.IDLE) {
            throw new IllegalStateException("A recording is already in progress");
        }
        long now = System.currentTimeMillis();
        RecordingStore.Session s = new RecordingStore.Session("rec_" + now, meetingId, now, SAMPLE_RATE, "recording");

        AudioRecord record = null;
        WavFileWriter writer = null;
        try {
            RecordingStore.save(appContext, s);
            writer = new WavFileWriter(RecordingStore.wavFile(appContext, s.sessionId), SAMPLE_RATE, 1);
            record = openAudioRecord();
            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("The microphone is in use by another app");
            }
        } catch (Exception e) {
            if (record != null) {
                record.release();
            }
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
            RecordingStore.delete(appContext, s.sessionId);
            throw e;
        }

        session = s;
        this.streamPcm = streamPcm;
        samplesWritten = 0;
        pending.clear();
        drainDeadline = 0;
        captureFinished = false;
        pauseRequested = false;
        running = true;
        state = State.RECORDING;

        final AudioRecord initialRecord = record;
        final WavFileWriter sessionWriter = writer;
        captureThread = new Thread(() -> captureLoop(initialRecord, sessionWriter), "MeetingRecorder-capture");
        consumerThread = new Thread(this::consumeLoop, "MeetingRecorder-consumer");
        captureThread.start();
        consumerThread.start();

        try {
            RecordingService.start(appContext);
        } catch (Exception e) {
            // Recording still works while the app is visible; only background capture is affected.
            Log.e(TAG, "Cannot start the foreground service", e);
            emitError("Background recording is not available: keep the app open. (" + e.getMessage() + ")");
        }
        notifyState(State.RECORDING, "started");
        Log.i(TAG, "Recording started: " + s.sessionId + " for meeting " + meetingId);
        return s;
    }

    public synchronized void pause() {
        if (state != State.RECORDING) {
            return;
        }
        pauseRequested = true;
        state = State.PAUSED;
        persistState("paused");
        RecordingService.refresh(appContext);
        notifyState(State.PAUSED, "user");
    }

    public synchronized void resume() {
        if (state != State.PAUSED) {
            return;
        }
        synchronized (pauseLock) {
            pauseRequested = false;
            pauseLock.notifyAll();
        }
        state = State.RECORDING;
        persistState("recording");
        RecordingService.refresh(appContext);
        notifyState(State.RECORDING, "user");
    }

    /**
     * Marks the current moment of the recording (also while paused) and saves it with the
     * session, so it survives a crash. Returns its position in ms, or -1 when not recording.
     */
    public synchronized long addBookmark() {
        RecordingStore.Session s = session;
        if (state == State.IDLE || s == null) {
            return -1;
        }
        long ms = getDurationMs();
        s.bookmarksMs.add(ms);
        persistState(s.state);
        Listener l = listener;
        if (l != null) {
            l.onBookmark(ms);
        }
        Log.i(TAG, "Bookmark at " + ms + " ms");
        return ms;
    }

    /** Stops capturing and returns the stopped session (or the last one, if already stopped). */
    public RecordingStore.Session stop() {
        return stopInternal("user");
    }

    private synchronized RecordingStore.Session stopInternal(String reason) {
        if (state == State.IDLE) {
            return lastStopped;
        }
        long stopRequestedAt = SystemClock.elapsedRealtime();
        running = false;
        synchronized (pauseLock) {
            pauseRequested = false;
            pauseLock.notifyAll();
        }
        join(captureThread, 3000);
        int backlog = pending.size();
        drainDeadline = SystemClock.elapsedRealtime() + CONSUMER_DRAIN_TIMEOUT_MS;
        join(consumerThread, CONSUMER_DRAIN_TIMEOUT_MS + 1000);
        Log.i(TAG, "Stop took " + (SystemClock.elapsedRealtime() - stopRequestedAt) + " ms, live consumers were "
                + (backlog * READ_SAMPLES * 1000L / SAMPLE_RATE) + " ms behind");
        captureThread = null;
        consumerThread = null;

        persistState("stopped");
        lastStopped = session;
        session = null;
        state = State.IDLE;
        RecordingService.stop(appContext);
        notifyState(State.IDLE, reason);
        Log.i(TAG, "Recording stopped (" + reason + "), " + getDurationMs() + " ms");
        return lastStopped;
    }

    @SuppressLint("MissingPermission") // checked by MeetingRecorderPlugin before starting
    private static AudioRecord openAudioRecord() {
        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        // 2 s of slack in the system buffer absorbs scheduling hiccups without losing audio.
        int bufferBytes = Math.max(minBuffer, SAMPLE_RATE * 2 * 2);
        // VOICE_RECOGNITION is tuned for ASR (no AGC, flat response); MIC is the universal fallback.
        int[] sources = { MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC };
        for (int source : sources) {
            try {
                AudioRecord r = new AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, bufferBytes);
                if (r.getState() == AudioRecord.STATE_INITIALIZED) {
                    return r;
                }
                r.release();
            } catch (IllegalArgumentException e) {
                Log.w(TAG, "Audio source " + source + " unavailable", e);
            }
        }
        throw new IllegalStateException("Cannot open the microphone");
    }

    private void captureLoop(AudioRecord initialRecord, WavFileWriter writer) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO);
        AudioRecord record = initialRecord;
        short[] buffer = new short[READ_SAMPLES];
        int consecutiveErrors = 0;
        long droppedChunks = 0;
        String failure = null;
        try {
            while (running) {
                if (pauseRequested) {
                    record.stop();
                    synchronized (pauseLock) {
                        while (pauseRequested && running) {
                            pauseLock.wait();
                        }
                    }
                    if (!running) {
                        break;
                    }
                    record.startRecording();
                    continue;
                }

                int read = record.read(buffer, 0, buffer.length);
                if (read > 0) {
                    consecutiveErrors = 0;
                    writer.write(buffer, read);
                    long offset = samplesWritten;
                    samplesWritten = offset + read;
                    if (!pending.offer(new Chunk(Arrays.copyOf(buffer, read), offset))) {
                        // Consumers are minutes behind: the file is complete, only live results lose this chunk.
                        if (droppedChunks++ % 100 == 0) {
                            Log.w(TAG, "Consumers too slow, dropped " + droppedChunks + " chunks");
                        }
                    }
                } else if (read < 0) {
                    consecutiveErrors++;
                    if (read == AudioRecord.ERROR_DEAD_OBJECT || consecutiveErrors >= 20) {
                        // The audio server restarted or the input died: reopen the microphone.
                        Log.w(TAG, "AudioRecord read error " + read + ", reopening the microphone");
                        record.release();
                        record = openAudioRecord();
                        record.startRecording();
                        consecutiveErrors = 0;
                        emitError("The microphone was interrupted and has been reopened");
                    } else {
                        Thread.sleep(20);
                    }
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "Cannot write the recording", e);
            failure = "storage-error";
            emitError("Cannot write the recording (storage full?). The audio recorded so far is kept.");
        } catch (Exception e) {
            Log.e(TAG, "Capture failed", e);
            failure = "microphone-error";
            emitError("Recording interrupted: " + e.getMessage() + ". The audio recorded so far is kept.");
        } finally {
            try {
                record.stop();
            } catch (Exception ignored) {
            }
            record.release();
            try {
                writer.close();
            } catch (IOException e) {
                Log.e(TAG, "Cannot finalize the WAV header", e);
            }
            captureFinished = true;
        }

        if (failure != null) {
            final String reason = failure;
            // stopInternal joins this thread, so it must run elsewhere.
            new Thread(() -> stopInternal(reason), "MeetingRecorder-stop").start();
        }
    }

    private void consumeLoop() {
        short[] pcmEvent = new short[PCM_EVENT_SAMPLES];
        int pcmFill = 0;
        long pcmStart = 0;
        try {
            while (true) {
                Chunk chunk = pending.poll(200, TimeUnit.MILLISECONDS);
                if (chunk == null) {
                    if (captureFinished) {
                        break;
                    }
                    continue;
                }
                if (drainDeadline > 0 && SystemClock.elapsedRealtime() > drainDeadline) {
                    Log.w(TAG, "Drain timeout: " + pending.size() + " chunks not sent to live consumers");
                    pending.clear();
                    break;
                }

                Listener l = listener;
                if (l != null) {
                    l.onLevel(level(chunk.samples));
                }

                if (streamPcm && l != null) {
                    if (pcmFill > 0 && chunk.offset != pcmStart + pcmFill) {
                        l.onPcm(pcmEvent, pcmFill, pcmStart); // gap after dropped chunks
                        pcmFill = 0;
                    }
                    int consumed = 0;
                    while (consumed < chunk.samples.length) {
                        if (pcmFill == 0) {
                            pcmStart = chunk.offset + consumed;
                        }
                        int n = Math.min(PCM_EVENT_SAMPLES - pcmFill, chunk.samples.length - consumed);
                        System.arraycopy(chunk.samples, consumed, pcmEvent, pcmFill, n);
                        pcmFill += n;
                        consumed += n;
                        if (pcmFill == PCM_EVENT_SAMPLES) {
                            l.onPcm(pcmEvent, pcmFill, pcmStart);
                            pcmFill = 0;
                        }
                    }
                }

                try {
                    VoskAudioBridge.feed(chunk.samples, chunk.samples.length, chunk.offset);
                } catch (Exception e) {
                    Log.w(TAG, "Live recognizer failed on a chunk", e);
                }
                RecordingAudioTaps.feed(chunk.samples, chunk.samples.length, chunk.offset);
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }

        Listener l = listener;
        if (pcmFill > 0 && streamPcm && l != null) {
            l.onPcm(pcmEvent, pcmFill, pcmStart);
        }
    }

    private static float level(short[] samples) {
        double sum = 0;
        for (short s : samples) {
            double v = s / 32768.0;
            sum += v * v;
        }
        double rms = Math.sqrt(sum / Math.max(1, samples.length));
        return (float) Math.min(1.0, rms * 5.0);
    }

    private void persistState(String value) {
        if (session == null) {
            return;
        }
        session.state = value;
        try {
            RecordingStore.save(appContext, session);
        } catch (IOException e) {
            Log.w(TAG, "Cannot update session metadata", e);
        }
    }

    private void notifyState(State s, String reason) {
        Listener l = listener;
        if (l != null) {
            l.onStateChanged(s, reason);
        }
    }

    private void emitError(String message) {
        Listener l = listener;
        if (l != null) {
            l.onError(message);
        }
    }

    private static void join(Thread t, long timeoutMs) {
        if (t == null) {
            return;
        }
        try {
            t.join(timeoutMs);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
