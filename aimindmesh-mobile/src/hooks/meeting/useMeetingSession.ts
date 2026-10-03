import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { SavedMeeting, TranscriptSegment } from '../../types/meeting';
import { saveMeeting as saveMeetingToStorage, storeMeetingAudioFile } from '../../services/meeting/meetingStorage';
import { guessAudioMimeType, toNativePath } from '../../services/meeting/audioPaths';
import { newMeetingId } from '../../services/meeting/meetingIds';
import { isMeetingDeleted, MeetingDeletedError, onSegmentsDeleted } from '../../services/meeting/meetingDeletions';
import { logger } from '../../services/logger';

const AUTOSAVE_DELAY_MS = 1500;
/** While recording the transcript is checkpointed, so a killed app keeps most of it */
const RECORDING_CHECKPOINT_MS = 30000;

export interface MeetingMeta {
    id: string | null;
    /** Start of the meeting: kept on every re-save */
    timestamp: number;
    /** Seconds */
    duration: number;
    hasAudio: boolean;
    audioMimeType?: string;
}

/**
 * State whose latest value is also readable synchronously. Saves read the ref: saving from a
 * callback right after setState used to persist the previous transcript.
 */
function useRefState<T>(initial: T): [T, Dispatch<SetStateAction<T>>, MutableRefObject<T>] {
    const [state, setState] = useState<T>(initial);
    const ref = useRef<T>(initial);
    const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
        const next = typeof action === 'function' ? (action as (prev: T) => T)(ref.current) : action;
        if (Object.is(next, ref.current)) return;
        ref.current = next;
        setState(next);
    }, []);
    return [state, set, ref];
}

const emptyMeta = (): MeetingMeta => ({ id: null, timestamp: 0, duration: 0, hasAudio: false });

/**
 * The meeting being shown: its id is fixed when a recording starts (or a saved meeting is opened)
 * and every save goes to that id, serialized, with the latest transcript and names.
 */
export function useMeetingSession(showToast: (message: string, type?: 'success' | 'error' | 'info') => void) {
    const [transcript, setTranscript, transcriptRef] = useRefState<TranscriptSegment[]>([]);
    const [speakerNames, setSpeakerNames, speakerNamesRef] = useRefState<Record<number, string>>({});
    const [meta, setMetaState] = useState<MeetingMeta>(emptyMeta);
    const metaRef = useRef<MeetingMeta>(meta);

    /** Plain path of the meeting audio (for playback, reprocessing and native plugins) */
    const audioFilePathRef = useRef<string | null>(null);
    /** Recording not moved into storage yet: retried at the next save */
    const pendingAudioFileRef = useRef<string | null>(null);
    /** In-memory WAV when the native file failed: written once */
    const pcmAudioBlobRef = useRef<Blob | null>(null);

    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const savedRef = useRef<{ transcript: TranscriptSegment[]; names: Record<number, string> }>({ transcript: [], names: {} });
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSaveAtRef = useRef(0);
    const suspendedRef = useRef(0);
    const showToastRef = useRef(showToast);
    showToastRef.current = showToast;

    const updateMeta = useCallback((patch: Partial<MeetingMeta>) => {
        metaRef.current = { ...metaRef.current, ...patch };
        setMetaState(metaRef.current);
    }, []);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const isDirty = useCallback(
        () => transcriptRef.current !== savedRef.current.transcript || speakerNamesRef.current !== savedRef.current.names,
        [transcriptRef, speakerNamesRef]
    );

    /** Saves a snapshot taken now; saves run one after the other. */
    const save = useCallback((): Promise<void> => {
        clearTimer();
        const current = metaRef.current;
        const transcriptSnapshot = transcriptRef.current;
        const namesSnapshot = speakerNamesRef.current;
        if (!current.id || (transcriptSnapshot.length === 0 && !current.hasAudio)) return saveChainRef.current;
        if (isMeetingDeleted(current.id)) return saveChainRef.current;

        savedRef.current = { transcript: transcriptSnapshot, names: namesSnapshot };
        lastSaveAtRef.current = Date.now();
        const pcmBlob = pcmAudioBlobRef.current;
        const pendingFile = pendingAudioFileRef.current;
        const payload = {
            id: current.id,
            timestamp: current.timestamp,
            duration: current.duration,
            transcript: transcriptSnapshot,
            speakerNames: namesSnapshot,
            hasAudio: current.hasAudio,
            audioMimeType: current.audioMimeType
        };

        saveChainRef.current = saveChainRef.current
            .then(() => saveMeetingToStorage(payload, { filePath: pendingFile, pcmBlob }))
            .then((saved) => {
                if (pcmBlob && pcmAudioBlobRef.current === pcmBlob) pcmAudioBlobRef.current = null;
                if (pendingFile && saved.audioFilePath && pendingAudioFileRef.current === pendingFile) {
                    pendingAudioFileRef.current = null;
                    if (metaRef.current.id === payload.id) audioFilePathRef.current = saved.audioFilePath;
                }
            }, (error) => {
                // Deleted meanwhile (History or sync): refusing the save is the point
                if (error instanceof MeetingDeletedError) return;
                logger.log('error', 'Failed to save meeting', error);
                // Dirty again: the next change retries
                if (savedRef.current.transcript === transcriptSnapshot) savedRef.current = { transcript: [], names: {} };
                showToastRef.current('Could not save the meeting', 'error');
            });
        return saveChainRef.current;
    }, [clearTimer, transcriptRef, speakerNamesRef]);

    /** Saves now if something is pending, then resolves when every save has finished. */
    const flush = useCallback((): Promise<void> => {
        if (suspendedRef.current === 0 && (timerRef.current || isDirty())) return save();
        return saveChainRef.current;
    }, [isDirty, save]);

    /** Called on every transcript/name change: debounced save, periodic checkpoints while recording. */
    const scheduleAutosave = useCallback((isRecording: boolean) => {
        if (!metaRef.current.id || suspendedRef.current > 0 || !isDirty()) return;
        const fire = () => {
            timerRef.current = null;
            if (suspendedRef.current === 0) void save();
        };
        if (isRecording) {
            if (timerRef.current) return; // a checkpoint is already due
            const wait = Math.max(AUTOSAVE_DELAY_MS, lastSaveAtRef.current + RECORDING_CHECKPOINT_MS - Date.now());
            timerRef.current = setTimeout(fire, wait);
            return;
        }
        clearTimer();
        timerRef.current = setTimeout(fire, AUTOSAVE_DELAY_MS);
    }, [clearTimer, isDirty, save]);

    /**
     * Reprocessing replaces the transcript step by step: no autosave may persist a half-built one.
     * Returns the function that resumes autosave.
     */
    const suspendAutosave = useCallback(() => {
        suspendedRef.current++;
        clearTimer();
        let resumed = false;
        return () => {
            if (resumed) return;
            resumed = true;
            suspendedRef.current = Math.max(0, suspendedRef.current - 1);
        };
    }, [clearTimer]);

    /** Every recording is its own meeting: reusing the previous id overwrote that meeting's audio. */
    const beginNewMeeting = useCallback(() => {
        void flush();
        updateMeta({ id: newMeetingId(), timestamp: Date.now(), duration: 0, hasAudio: false, audioMimeType: undefined });
        audioFilePathRef.current = null;
        pendingAudioFileRef.current = null;
        pcmAudioBlobRef.current = null;
        setTranscript([]);
        setSpeakerNames({});
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current };
    }, [flush, updateMeta, setTranscript, setSpeakerNames, transcriptRef, speakerNamesRef]);

    const openMeeting = useCallback((meeting: SavedMeeting, audioFilePath: string | null) => {
        void flush();
        updateMeta({
            id: meeting.id,
            timestamp: meeting.timestamp,
            duration: meeting.duration || 0,
            hasAudio: meeting.hasAudio,
            audioMimeType: meeting.audioMimeType
        });
        audioFilePathRef.current = audioFilePath;
        pendingAudioFileRef.current = null;
        pcmAudioBlobRef.current = null;
        setTranscript(meeting.transcript || []);
        setSpeakerNames(meeting.speakerNames || {});
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current };
    }, [flush, updateMeta, setTranscript, setSpeakerNames, transcriptRef, speakerNamesRef]);

    /**
     * Attaches a finished recording to the current meeting and moves it into storage. Returns the
     * plain path to play it from (null when only an in-memory WAV exists).
     */
    const attachRecording = useCallback(async (filePath: string | undefined, pcmBlob: Blob | null, durationMs: number): Promise<string | null> => {
        if (durationMs > 0) updateMeta({ duration: durationMs / 1000 });
        const id = metaRef.current.id;
        if (filePath && id) {
            const stored = await storeMeetingAudioFile(id, filePath);
            if (stored) {
                audioFilePathRef.current = stored.filePath;
            } else {
                audioFilePathRef.current = toNativePath(filePath);
                pendingAudioFileRef.current = filePath;
            }
            updateMeta({ hasAudio: true, audioMimeType: stored?.mimeType ?? guessAudioMimeType(filePath) });
            return audioFilePathRef.current;
        }
        if (pcmBlob && pcmBlob.size > 0) {
            pcmAudioBlobRef.current = pcmBlob;
            updateMeta({ hasAudio: true, audioMimeType: 'audio/wav' });
        }
        return null;
    }, [updateMeta]);

    /**
     * The open meeting was deleted (History or sync). A recording in progress continues as a new
     * meeting (its audio is not lost); otherwise the screen goes back to an empty session.
     */
    const handleMeetingDeleted = useCallback((meetingId: string, isRecording: boolean): 'none' | 'reset' | 'detached' => {
        if (metaRef.current.id !== meetingId) return 'none';
        clearTimer();
        if (isRecording) {
            updateMeta({ id: newMeetingId() });
            // Dirty: the next checkpoint writes the transcript under the new id
            savedRef.current = { transcript: [], names: {} };
            return 'detached';
        }
        updateMeta(emptyMeta());
        audioFilePathRef.current = null;
        pendingAudioFileRef.current = null;
        pcmAudioBlobRef.current = null;
        setTranscript([]);
        setSpeakerNames({});
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current };
        return 'reset';
    }, [clearTimer, updateMeta, setTranscript, setSpeakerNames, transcriptRef, speakerNamesRef]);

    // Segments deleted on another device leave the open transcript too (else a save brings them back)
    useEffect(() => onSegmentsDeleted(ids => {
        if (transcriptRef.current.some(seg => ids.has(seg.id))) {
            setTranscript(prev => prev.filter(seg => !ids.has(seg.id)));
        }
    }), [setTranscript, transcriptRef]);

    const getTranscript = useCallback(() => transcriptRef.current, [transcriptRef]);
    const getMeetingTimestamp = useCallback(() => metaRef.current.timestamp || Date.now(), []);
    const getMeetingId = useCallback(() => metaRef.current.id, []);

    // Leaving the screen saves what is pending (not during reprocessing: the previous version stays)
    useEffect(() => () => {
        if (suspendedRef.current === 0 && (timerRef.current || isDirty())) void save();
        clearTimer();
    }, [isDirty, save, clearTimer]);

    return {
        transcript,
        setTranscript,
        speakerNames,
        setSpeakerNames,
        meta,
        audioFilePathRef,
        pcmAudioBlobRef,
        save,
        flush,
        scheduleAutosave,
        suspendAutosave,
        beginNewMeeting,
        openMeeting,
        attachRecording,
        handleMeetingDeleted,
        getTranscript,
        getMeetingTimestamp,
        getMeetingId
    };
}

export type MeetingSession = ReturnType<typeof useMeetingSession>;
