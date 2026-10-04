import { useCallback, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Bookmark, EMPTY_NOTES, MeetingQuestion, SavedMeeting, TranscriptSegment } from '../../types/meeting';
import { displayTitle, mergeBookmarks } from '../../services/meeting/meetingNotes';
import { loadMeeting, replaceMeetingTranscript, updateMeetingSpeakers } from '../../services/meeting/meetingRecords';
import { resolveMeetingAudio } from '../../services/meeting/meetingStorage';
import { toNativePath } from '../../services/meeting/audioPaths';
import { knownVoiceNames, learnSpeakerVoice, nameKnownSpeakers } from '../../services/speaker/knownVoices';
import type { SpeakersResult, TranscriptionResult } from '../../services/meeting/postProcessing/pipeline';
import { assignSpeaker, newSpeakerId, speakerLabel, speakerMenuChoices } from '../../services/meeting/speakerEdits';
import { askChoice, askText } from '../../services/ui/dialogs';
import { logger } from '../../services/logger';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { AudioPlaybackState } from './useAudioPlayback';
import { MeetingSession } from './useMeetingSession';

interface Options {
    session: MeetingSession;
    playback: Pick<AudioPlaybackState, 'setRecordedAudioUrl' | 'setAudioDuration'>;
    diarizationRef: React.MutableRefObject<SpeakerDiarization>;
    /** Whether to name speakers from known voices and learn voices the user names. */
    recognizeVoicesRef: React.MutableRefObject<boolean>;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const listNames = (names: Record<number, string>) => Object.values(names).join(', ');

/**
 * What the user (and late results) change in the meeting on screen: speakers, titles, marks,
 * questions, and transcripts that arrive for a meeting that may no longer be on screen. The
 * session (useMeetingSession) holds the state and saves it.
 */
export function useMeetingEdits({ session, playback, diarizationRef, recognizeVoicesRef, showToast }: Options) {
    const [currentText, setCurrentText] = useState('');
    /** A segment to scroll to and highlight (search result, cited time). */
    const [focus, setFocus] = useState<{ segmentId: string; nonce: number } | null>(null);
    const { setTranscript, setSpeakerNames, setNotes, metaRef, transcriptRef, audioFilePathRef } = session;
    const { setRecordedAudioUrl, setAudioDuration } = playback;
    const isOnScreen = (meetingId: string) => metaRef.current.id === meetingId;

    /** Points the player and the post-processing at a meeting audio file. */
    const showAudio = useCallback((path: string, durationSec: number) => {
        const nativePath = toNativePath(path);
        audioFilePathRef.current = nativePath;
        setRecordedAudioUrl(Capacitor.convertFileSrc(nativePath));
        setAudioDuration(durationSec);
    }, [audioFilePathRef, setRecordedAudioUrl, setAudioDuration]);

    /** Clears what belongs to the previous meeting on screen (the session itself is set by the caller). */
    const resetScreen = useCallback(() => {
        setCurrentText('');
        setFocus(null);
        diarizationRef.current.clear();
        setRecordedAudioUrl(null);
        setAudioDuration(0);
    }, [diarizationRef, setRecordedAudioUrl, setAudioDuration]);

    /** A new meeting for a recording (null: an empty screen). Returns its id. */
    const startNewMeeting = useCallback((withId = true) => {
        resetScreen();
        return session.beginNewMeeting(withId);
    }, [resetScreen, session]);

    /** Shows a stored meeting with its audio. */
    const showMeeting = useCallback(async (meeting: SavedMeeting) => {
        resetScreen();
        const audio = meeting.hasAudio ? await resolveMeetingAudio(meeting).catch(e => {
            logger.log('warn', 'Failed to load the meeting audio', e);
            return null;
        }) : null;
        session.openMeeting(meeting, audio?.filePath ?? null);
        if (audio) {
            setRecordedAudioUrl(audio.url);
            setAudioDuration(meeting.duration || 0);
        }
    }, [resetScreen, session, setRecordedAudioUrl, setAudioDuration]);

    /** Shows a saved meeting with its audio; false if it can't be loaded. */
    const openSavedMeeting = useCallback(async (meetingId: string): Promise<boolean> => {
        const meeting = await loadMeeting(meetingId).catch(e => {
            logger.log('error', `Failed to load meeting ${meetingId}`, e);
            return null;
        });
        if (!meeting) return false;
        await showMeeting(meeting);
        return true;
    }, [showMeeting]);

    const addBookmarks = useCallback((added: Bookmark[]) => {
        if (added.length === 0) return;
        setNotes(n => ({ ...n, bookmarks: mergeBookmarks(n.bookmarks, added) }));
    }, [setNotes]);

    const focusSegment = useCallback((segmentId: string) => setFocus({ segmentId, nonce: Date.now() }), []);

    /**
     * A new transcript for `meetingId`, on screen or stored: speakers whose voice is known get
     * their name. Returns the names and a note on who was recognized, if anyone.
     */
    const applyTranscript = useCallback(async (meetingId: string, { transcript: segments, voices }: TranscriptionResult) => {
        const names = await nameKnownSpeakers(meetingId, voices, recognizeVoicesRef.current);
        if (isOnScreen(meetingId)) {
            setTranscript(segments);
            setSpeakerNames(names); // speaker numbers were reassigned
            setCurrentText('');
        } else {
            await replaceMeetingTranscript(meetingId, segments, names);
        }
        return { names, note: Object.keys(names).length ? `recognized ${listNames(names)}` : undefined };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recognizeVoicesRef, setTranscript, setSpeakerNames]);

    /** New speakers for the transcript of `meetingId` (see applyTranscript). */
    const applySpeakers = useCallback(async (meetingId: string, { speakers, voices }: SpeakersResult) => {
        const names = await nameKnownSpeakers(meetingId, voices, recognizeVoicesRef.current);
        if (isOnScreen(meetingId)) {
            setTranscript(prev => prev.map(t => ({ ...t, speakerId: speakers.get(t.id) ?? t.speakerId })));
            setSpeakerNames(names);
        } else {
            await updateMeetingSpeakers(meetingId, speakers, names);
        }
        return Object.keys(names).length ? `recognized ${listNames(names)}` : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recognizeVoicesRef, setTranscript, setSpeakerNames]);

    /** Names a speaker; their voice is remembered for later meetings. */
    const nameSpeaker = async (speakerId: number, name: string) => {
        setSpeakerNames(prev => ({ ...prev, [speakerId]: name }));
        const meetingId = metaRef.current.id;
        if (!meetingId || !recognizeVoicesRef.current) return;
        try {
            const learned = await learnSpeakerVoice(meetingId, speakerId, name);
            if (learned) showToast(`The voice of ${name} will be recognized in the next meetings`, 'success');
        } catch (e) {
            logger.log('warn', 'Could not learn the voice', e);
        }
    };

    const renameSpeaker = async (speakerId: number) => {
        const names = session.speakerNames;
        const current = speakerLabel(speakerId, names);
        const used = new Set(Object.values(names));
        const known = (await knownVoiceNames()).filter(n => !used.has(n));
        let newName: string | null = null;
        if (known.length > 0) {
            const choice = await askChoice({
                title: `Who is ${current}?`,
                choices: [
                    ...known.map(n => ({ id: `name:${n}`, label: n, description: 'Known voice' })),
                    { id: 'other', label: 'Another name…' }
                ]
            });
            if (choice?.startsWith('name:')) newName = choice.slice(5);
            else if (choice === 'other') newName = await askText({ title: 'Speaker name', initial: '' });
        } else {
            newName = await askText({ title: 'Speaker name', initial: current });
        }
        if (newName && newName.trim()) {
            await nameSpeaker(speakerId, newName.trim());
        }
    };

    /** Tapping a sentence's speaker: rename them, or say the sentence is someone else's. */
    const openSpeakerMenu = async (segment: TranscriptSegment) => {
        const names = session.speakerNames;
        const text = segment.text.length > 80 ? `${segment.text.slice(0, 80)}…` : segment.text;
        const choice = await askChoice({
            title: speakerLabel(segment.speakerId, names),
            message: `“${text}”`,
            choices: speakerMenuChoices(transcriptRef.current, names, segment)
        });
        if (choice === 'rename') {
            await renameSpeaker(segment.speakerId);
        } else if (choice === 'new') {
            const id = newSpeakerId(transcriptRef.current, names);
            setTranscript(prev => assignSpeaker(prev, segment.id, id));
        } else if (choice?.startsWith('set:')) {
            setTranscript(prev => assignSpeaker(prev, segment.id, Number(choice.slice(4))));
        }
    };

    const renameMeeting = async () => {
        if (!metaRef.current.id) return;
        const notes = session.notes ?? EMPTY_NOTES;
        const newTitle = await askText({
            title: 'Meeting title',
            initial: notes.title || notes.analysis?.title || '',
            placeholder: displayTitle({ timestamp: metaRef.current.timestamp, title: '', analysis: null })
        });
        if (newTitle !== null) {
            setNotes(n => ({ ...n, title: newTitle.trim() }));
        }
    };

    const editSegment = (segment: TranscriptSegment, newText: string) => {
        setTranscript(prev => prev.map(t => t.id === segment.id
            ? { ...t, text: newText, originalText: t.originalText || t.text, isEdited: true, editedAt: Date.now() }
            : t));
    };

    const removeBookmark = (bookmark: Bookmark) => {
        setNotes(n => ({ ...n, bookmarks: n.bookmarks.filter(b => b.id !== bookmark.id) }));
    };

    const deleteQuestion = (question: MeetingQuestion) => {
        setNotes(n => ({ ...n, questions: n.questions.filter(q => q.id !== question.id) }));
    };

    return {
        currentText, setCurrentText,
        focus, focusSegment,
        showAudio, resetScreen, startNewMeeting, showMeeting, openSavedMeeting,
        addBookmarks, applyTranscript, applySpeakers,
        openSpeakerMenu, renameMeeting, editSegment, removeBookmark, deleteQuestion
    };
}
