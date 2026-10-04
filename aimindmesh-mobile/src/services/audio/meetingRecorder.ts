import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

/**
 * Native meeting recorder (android: recording/MeetingRecorderPlugin).
 *
 * Audio is captured by a foreground service and written to disk as it arrives, so a recording
 * survives the screen turning off, the app going to background and even a crash. All offsets
 * and durations are in samples/ms of recorded audio (16 kHz mono, pauses excluded): the same
 * clock as the saved file and as live Vosk timestamps.
 */

export type RecorderState = 'idle' | 'recording' | 'paused';

export interface RecorderSession {
    sessionId: string;
    meetingId: string;
    startedAt: number;
    /** The session WAV being written (16 kHz mono PCM16, 44-byte header), readable while recording. */
    wavPath?: string;
}

export interface StoppedSession extends RecorderSession {
    durationMs: number;
}

export interface FinalizedRecording {
    meetingId: string;
    /** Absolute path of files/meeting-audio/{meetingId}.audio */
    audioPath: string;
    mimeType: string;
    durationMs: number;
    startedAt: number;
    /** Moments marked during the recording (ms into it). */
    bookmarks?: number[];
    /** With keepWav: the recording as 16 kHz WAV, for the transcription. */
    wavPath?: string;
    /** True when wavPath is a temporary file to delete after use (else it is the meeting audio). */
    wavIsTemporary?: boolean;
}

export interface RecorderStatus {
    state: RecorderState;
    sessionId?: string;
    meetingId?: string;
    startedAt?: number;
    durationMs?: number;
    streamPcm?: boolean;
    bookmarks?: number[];
    wavPath?: string;
}

export interface RecoverableSession extends RecorderSession {
    durationMs: number;
    bookmarks?: number[];
}

export interface MeetingRecorderPlugin {
    /**
     * Starts recording into a new session for `meetingId`. Asks for the microphone (and, on
     * Android 13+, notification) permission when needed.
     * @param options.streamPcm emit 'pcm' events with the recorded audio (for Whisper live and
     *   live speaker embeddings)
     */
    start(options: { meetingId: string; streamPcm?: boolean }): Promise<RecorderSession>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    /** Stops capturing; the audio stays in the session file until finalizeRecording(). */
    stop(): Promise<StoppedSession>;
    /** Encodes a stopped or interrupted session into the meeting audio file. */
    /**
     * @param options.targetMeetingId give the audio to this meeting instead of the session's
     *   (its meeting was deleted while it was recorded)
     */
    finalizeRecording(options: { sessionId: string; keepWav?: boolean; targetMeetingId?: string }): Promise<FinalizedRecording>;
    getStatus(): Promise<RecorderStatus>;
    /** Sessions left on disk by a crash, which can be finalized or discarded. */
    listRecoverable(): Promise<{ sessions: RecoverableSession[] }>;
    /** Deletes the audio of an interrupted session. */
    discard(options: { sessionId: string }): Promise<void>;
    /**
     * Marks the current moment of the recording; it is saved with the session. The recording
     * notification has the same action, so 'bookmark' events also come from there.
     */
    addBookmark(): Promise<{ ms: number }>;

    addListener(eventName: 'level', listenerFunc: (event: { level: number }) => void): Promise<PluginListenerHandle>;
    /** `data`: base64 PCM16 little-endian; `offset`: index of its first sample in the recording. */
    addListener(eventName: 'pcm', listenerFunc: (event: { data: string; offset: number }) => void): Promise<PluginListenerHandle>;
    /** `reason` is 'started', 'user', or 'storage-error' / 'microphone-error' when capture failed. */
    addListener(eventName: 'state', listenerFunc: (event: { state: RecorderState; reason: string }) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'error', listenerFunc: (event: { message: string }) => void): Promise<PluginListenerHandle>;
    addListener(eventName: 'bookmark', listenerFunc: (event: { ms: number }) => void): Promise<PluginListenerHandle>;
}

export const MeetingRecorder = registerPlugin<MeetingRecorderPlugin>('MeetingRecorder');

export const RECORDER_SAMPLE_RATE = 16000;
