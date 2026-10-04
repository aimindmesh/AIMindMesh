import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { App as CapApp } from '@capacitor/app';
import { EMPTY_NOTES, MeetingNotes, SavedMeeting, TranscriptSegment } from '../../types/meeting';
import { hasNotes } from '../../services/meeting/meetingNotes';
import { saveMeeting as saveMeetingToStorage } from '../../services/meeting/meetingStorage';
import { newMeetingId } from '../../services/meeting/meetingIds';
import { isMeetingDeleted, MeetingDeletedError, onSegmentsDeleted } from '../../services/meeting/meetingDeletions';
import { logger } from '../../services/logger';

const AUTOSAVE_DELAY_MS = 1500;
/** While recording the transcript is checkpointed, so a killed app keeps most of it */
const RECORDING_CHECKPOINT_MS = 10000;

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

interface SavedSnapshot {
    transcript: TranscriptSegment[];
    names: Record<number, string>;
    notes: MeetingNotes;
}

/** A snapshot equal to nothing on screen: the next change (or flush) saves. */
const unsaved = (): SavedSnapshot => ({ transcript: [], names: {}, notes: { ...EMPTY_NOTES } });

/**
 * The meeting being shown: its id is fixed when a recording starts (or a saved meeting is opened)
 * and every save goes to that id, serialized, with the latest transcript and names.
 */
export function useMeetingSession(showToast: (message: string, type?: 'success' | 'error' | 'info') => void) {
    const [transcript, setTranscript, transcriptRef] = useRefState<TranscriptSegment[]>([]);
    const [speakerNames, setSpeakerNames, speakerNamesRef] = useRefState<Record<number, string>>({});
    /** Title, bookmarks, AI notes and questions of the meeting on screen */
    const [notes, setNotes, notesRef] = useRefState<MeetingNotes>(EMPTY_NOTES);
    const [meta, setMetaState] = useState<MeetingMeta>(emptyMeta);
    const metaRef = useRef<MeetingMeta>(meta);

    /** Plain path of the meeting audio (for playback, post-processing and native plugins) */
    const audioFilePathRef = useRef<string | null>(null);

    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const savedRef = useRef<SavedSnapshot>({ transcript: [], names: {}, notes: EMPTY_NOTES });
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
        () => transcriptRef.current !== savedRef.current.transcript || speakerNamesRef.current !== savedRef.current.names
            || notesRef.current !== savedRef.current.notes,
        [transcriptRef, speakerNamesRef, notesRef]
    );

    /** Saves a snapshot taken now; saves run one after the other. */
    const save = useCallback((): Promise<void> => {
        clearTimer();
        const current = metaRef.current;
        const transcriptSnapshot = transcriptRef.current;
        const namesSnapshot = speakerNamesRef.current;
        const notesSnapshot = notesRef.current;
        if (!current.id || (transcriptSnapshot.length === 0 && !current.hasAudio && !hasNotes(notesSnapshot))) return saveChainRef.current;
        if (isMeetingDeleted(current.id)) return saveChainRef.current;

        savedRef.current = { transcript: transcriptSnapshot, names: namesSnapshot, notes: notesSnapshot };
        lastSaveAtRef.current = Date.now();
        const payload = {
            id: current.id,
            timestamp: current.timestamp,
            duration: current.duration,
            transcript: transcriptSnapshot,
            speakerNames: namesSnapshot,
            hasAudio: current.hasAudio,
            audioMimeType: current.audioMimeType,
            ...notesSnapshot
        };

        // The audio is linked by the recorder (attachRecordingToMeeting): a save never moves files
        saveChainRef.current = saveChainRef.current
            .then(() => saveMeetingToStorage(payload))
            .then(() => { }, (error) => {
                // Deleted meanwhile (History or sync): refusing the save is the point
                if (error instanceof MeetingDeletedError) return;
                logger.log('error', 'Failed to save meeting', error);
                // Dirty again: the next change retries
                if (savedRef.current.transcript === transcriptSnapshot) savedRef.current = unsaved();
                showToastRef.current('Could not save the meeting', 'error');
            });
        return saveChainRef.current;
    }, [clearTimer, transcriptRef, speakerNamesRef, notesRef]);

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

    /**
     * Every recording is its own meeting: reusing the previous id overwrote that meeting's audio.
     * Returns the new meeting's id (null clears the screen instead).
     */
    const beginNewMeeting = useCallback((withId = true): string | null => {
        void flush();
        const id = withId ? newMeetingId() : null;
        updateMeta(id ? { id, timestamp: Date.now(), duration: 0, hasAudio: false, audioMimeType: undefined } : emptyMeta());
        audioFilePathRef.current = null;
        setTranscript([]);
        setSpeakerNames({});
        setNotes(EMPTY_NOTES);
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current, notes: notesRef.current };
        return id;
    }, [flush, updateMeta, setTranscript, setSpeakerNames, setNotes, transcriptRef, speakerNamesRef, notesRef]);

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
        setTranscript(meeting.transcript || []);
        setSpeakerNames(meeting.speakerNames || {});
        setNotes({
            title: meeting.title ?? '',
            bookmarks: meeting.bookmarks ?? [],
            analysis: meeting.analysis ?? null,
            questions: meeting.questions ?? []
        });
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current, notes: notesRef.current };
    }, [flush, updateMeta, setTranscript, setSpeakerNames, setNotes, transcriptRef, speakerNamesRef, notesRef]);

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
            savedRef.current = unsaved();
            return 'detached';
        }
        updateMeta(emptyMeta());
        audioFilePathRef.current = null;
        setTranscript([]);
        setSpeakerNames({});
        setNotes(EMPTY_NOTES);
        savedRef.current = { transcript: transcriptRef.current, names: speakerNamesRef.current, notes: notesRef.current };
        return 'reset';
    }, [clearTimer, updateMeta, setTranscript, setSpeakerNames, setNotes, transcriptRef, speakerNamesRef, notesRef]);

    // Segments deleted on another device leave the open transcript too (else a save brings them back)
    useEffect(() => onSegmentsDeleted(ids => {
        if (transcriptRef.current.some(seg => ids.has(seg.id))) {
            setTranscript(prev => prev.filter(seg => !ids.has(seg.id)));
        }
    }), [setTranscript, transcriptRef]);

    const getTranscript = useCallback(() => transcriptRef.current, [transcriptRef]);
    const getMeetingTimestamp = useCallback(() => metaRef.current.timestamp || Date.now(), []);
    const getMeetingId = useCallback(() => metaRef.current.id, []);

    // The app going to the background may be the last chance to save (Android can kill it there)
    useEffect(() => {
        const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
            if (!isActive) void flush();
        });
        return () => { handle.then(h => h.remove()).catch(() => { }); };
    }, [flush]);

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
        notes,
        setNotes,
        notesRef,
        meta,
        metaRef,
        updateMeta,
        transcriptRef,
        audioFilePathRef,
        save,
        flush,
        scheduleAutosave,
        suspendAutosave,
        beginNewMeeting,
        openMeeting,
        handleMeetingDeleted,
        getTranscript,
        getMeetingTimestamp,
        getMeetingId
    };
}

export type MeetingSession = ReturnType<typeof useMeetingSession>;
