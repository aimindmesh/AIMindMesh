/**
 * MeetingMode - Meeting recording and transcription assistant. It wires together:
 * - the meeting on screen and its saving (useMeetingSession), the user's edits (useMeetingEdits);
 * - native recording with live Vosk or Voxtral (useMeetingRecording), crash recovery;
 * - Whisper transcript and speakers after (and during) recording (useMeetingPostProcessing);
 * - AI notes and questions (useMeetingNotesAI), the player the transcript follows (useAudioPlayback);
 * - History, export and settings (components/meeting/*, services/meeting/*).
 * It stays mounted (hidden) while a recording or a transcription goes on after it is closed.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { AIMindMeshServerSettings, LLMConfig, SpeechConfig } from '../../types';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { logger } from '../../services/logger';
import { attachRecordingToMeeting, loadMeeting } from '../../services/meeting/meetingRecords';
import { bookmarksFromPositions, displayTitle, formatMeetingDate } from '../../services/meeting/meetingNotes';
import { bookmarkPlaybackStart, segmentIndexAt } from '../../services/meeting/transcriptTimeline';
import { formatClock } from '../../services/llm/meetingPrompts';
import { supportsTaskAudio, TaskKeys } from '../../services/llm/taskCompletion';
import { FinalizedRecording } from '../../services/audio/meetingRecorder';
import { registerBackHandler } from '../../services/native/backButtonRegistry';
import { onMeetingDeleted } from '../../services/meeting/meetingDeletions';
import { enterActivity, leaveActivity, unloadEngines } from '../../services/model/modelOrchestrator';
import { askChoice, askConfirm } from '../../services/ui/dialogs';
import { EMPTY_NOTES } from '../../types/meeting';

import { useMeetingSettings, speakerOptionsFrom, transcribeOptionsFrom } from '../../hooks/meeting/useMeetingSettings';
import { useAudioPlayback } from '../../hooks/meeting/useAudioPlayback';
import { useMeetingRecording } from '../../hooks/meeting/useMeetingRecording';
import { useMeetingSession } from '../../hooks/meeting/useMeetingSession';
import { useMeetingEdits } from '../../hooks/meeting/useMeetingEdits';
import { MeetingContext } from '../../hooks/meeting/useMeetingAnalysis';
import { useMeetingNotesAI } from '../../hooks/meeting/useMeetingNotesAI';
import { useRecordingRecovery } from '../../hooks/meeting/useRecordingRecovery';
import { useDiarizationSync } from '../../hooks/meeting/useDiarizationSync';
import { useMeetingPostProcessing, describeJob, PostProcessTarget } from '../../hooks/meeting/useMeetingPostProcessing';
import { useVoskTranscription } from '../../hooks/meeting/useVoskTranscription';
import { useOverlapDetection } from '../../hooks/meeting/useOverlapDetection';
import { useMeetingInitialization } from '../../hooks/meeting/useMeetingInitialization';
import { useAudioImport, ImportedAudio } from '../../hooks/meeting/useAudioImport';

import { MeetingHeader, MeetingTranscript, MeetingNotesPanel, MeetingControls, ExportBottomSheet } from '.';
import MeetingHistory from './MeetingHistory';
import MeetingTitleBar, { MeetingView } from './MeetingTitleBar';
import WelcomeCard, { isWelcomeDismissed } from './WelcomeCard';
import RecoveryBanner from './RecoveryBanner';
import Toast from '../ui/Toast';

export interface MeetingBusyState {
    recording: boolean;
    /** Seconds recorded so far, while recording */
    startedAt?: number;
    processing: string | null;
}

interface MeetingModeProps {
    /** Closes the screen (a recording or transcription in progress goes on in the background). */
    onClose: () => void;
    /** Hidden: kept mounted for a recording or transcription that goes on after closing. */
    hidden?: boolean;
    /** What the meeting is doing, so the app keeps it mounted and shows it outside the screen. */
    onBusyChange?: (busy: MeetingBusyState | null) => void;
    /** Messages while hidden are shown by the app. */
    onBackgroundToast?: (message: string, type: 'success' | 'error' | 'info') => void;
    onOpenSettings?: (tab?: string) => void;
    llmConfig: LLMConfig;
    keys: TaskKeys;
    serverSettings?: AIMindMeshServerSettings;
    speechConfig?: SpeechConfig;
}

const isWideScreen = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

const MeetingMode: React.FC<MeetingModeProps> = ({ onClose, hidden = false, onBusyChange, onBackgroundToast, onOpenSettings, llmConfig, keys, serverSettings, speechConfig }) => {
    const [view, setView] = useState<MeetingView>('transcript');
    const [showWelcome, setShowWelcome] = useState(() => !isWelcomeDismissed());
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isExportSheetOpen, setIsExportSheetOpen] = useState(false);
    const [toast, setToast] = useState<{ message: string; isVisible: boolean; type: 'success' | 'error' | 'info' }>({ message: '', isVisible: false, type: 'success' });

    const hiddenRef = useRef(hidden);
    hiddenRef.current = hidden;
    const backgroundToastRef = useRef(onBackgroundToast);
    backgroundToastRef.current = onBackgroundToast;
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        if (hiddenRef.current && backgroundToastRef.current) backgroundToastRef.current(message, type);
        else setToast({ message, isVisible: true, type });
    }, []);

    const settings = useMeetingSettings();
    const playback = useAudioPlayback({ showToast });
    const diarizationRef = useRef<SpeakerDiarization>(new SpeakerDiarization());
    const recognizeVoicesRef = useRef(settings.recognizeVoices);
    recognizeVoicesRef.current = settings.recognizeVoices;

    const session = useMeetingSession(showToast);
    const { transcript, setTranscript, speakerNames, notes, setNotes, meta, metaRef, transcriptRef, notesRef, audioFilePathRef } = session;
    const edits = useMeetingEdits({ session, playback, diarizationRef, recognizeVoicesRef, showToast });
    const { currentText, setCurrentText, focus, focusSegment, showAudio, addBookmarks } = edits;
    const currentMeetingId = meta.id;

    const transcriptionModeRef = useRef(settings.transcriptionMode);
    transcriptionModeRef.current = settings.transcriptionMode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const startTranscriptionRef = useRef<(target: PostProcessTarget, recording?: FinalizedRecording) => void>(() => { });
    const keepWavRef = useRef<() => boolean>(() => false);

    // ===== AI notes and questions =====
    const ai = useMeetingNotesAI({
        llmConfig, keys, serverSettings, showToast,
        getScreen: () => ({ meetingId: metaRef.current.id, notes: notesRef.current }),
        setNotes,
        getAutoSettings: () => ({ enabled: settingsRef.current.autoAnalyze, language: settingsRef.current.transcriptionLanguage })
    });
    const { analyzeFinalTranscript } = ai;

    const handleRecordingStopped = useCallback(async (rec: FinalizedRecording) => {
        const bookmarks = bookmarksFromPositions(rec.bookmarks);
        // Written at once, so the audio is linked even if the app dies before the next autosave
        try {
            await attachRecordingToMeeting({ ...rec, bookmarks });
        } catch (e) {
            logger.log('error', 'Failed to link the recording to its meeting', e);
        }
        if (metaRef.current.id === rec.meetingId) {
            const durationSec = rec.durationMs / 1000;
            showAudio(rec.audioPath, durationSec);
            addBookmarks(bookmarks);
            session.updateMeta({ hasAudio: true, audioMimeType: rec.mimeType, duration: durationSec });
        }
        if (settingsRef.current.autoTranscribe) {
            // Voxtral and Whisper together do not fit in RAM
            if (transcriptionModeRef.current === 'voxtral') await unloadEngines(['voxtral'], 'meeting transcription').catch(() => { });
            startTranscriptionRef.current({ meetingId: rec.meetingId, startedAt: rec.startedAt, audioPath: rec.audioPath }, rec);
        } else if (metaRef.current.id === rec.meetingId) {
            // The live transcript is final: notes can start now
            analyzeFinalTranscript(rec.meetingId, transcriptRef.current);
        }
    }, [showAudio, addBookmarks, analyzeFinalTranscript, session, metaRef, transcriptRef]);

    const handleSessionReattached = useCallback(async ({ meetingId, startedAt, bookmarks }: { meetingId: string; startedAt: number; bookmarks: number[] }) => {
        // The transcript autosaved before the UI went away
        const saved = await loadMeeting(meetingId).catch(() => null);
        edits.resetScreen();
        session.openMeeting(saved ?? { id: meetingId, timestamp: startedAt, transcript: [], speakerNames: {}, duration: 0, hasAudio: false }, null);
        addBookmarks(bookmarksFromPositions(bookmarks));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addBookmarks, session]);

    const recording = useMeetingRecording({
        recognitionModeRef: settings.recognitionModeRef,
        transcriptionModeRef,
        showToast,
        onRecordingStopped: handleRecordingStopped,
        onSessionReattached: handleSessionReattached,
        onBookmark: ms => addBookmarks(bookmarksFromPositions([ms])),
        shouldKeepWav: () => keepWavRef.current(),
        setTranscript,
        diarizationRef
    });

    /** What the AI gets to know about the meeting on screen. */
    const currentContext = (): MeetingContext | null => meta.id ? {
        meetingId: meta.id,
        transcript,
        speakerNames,
        bookmarks: notes.bookmarks,
        questions: notes.questions,
        language: settings.transcriptionLanguage,
        audio: playback.recordedAudioUrl
            ? { url: playback.recordedAudioUrl, mimeType: meta.audioMimeType ?? null, filePath: audioFilePathRef.current }
            : undefined
    } : null;

    // ===== On-device post-processing =====
    const postProcessing = useMeetingPostProcessing({
        showToast,
        onTranscript: async (meetingId, result) => {
            const { names, note } = await edits.applyTranscript(meetingId, result);
            analyzeFinalTranscript(meetingId, result.transcript, names);
            return note;
        },
        onSpeakers: (meetingId, result) => edits.applySpeakers(meetingId, result)
    });

    /** Whisper on a recording: finishing what was transcribed while recording, when there is. */
    startTranscriptionRef.current = (target: PostProcessTarget, finished?: FinalizedRecording) => {
        if (finished) postProcessing.transcribeFinished(target, finished, transcribeOptionsFrom(settings));
        else postProcessing.transcribe(target, transcribeOptionsFrom(settings));
    };
    keepWavRef.current = () => !!metaRef.current.id && postProcessing.isLive(metaRef.current.id);

    /** The meeting on screen, if its audio is a file the post-processing can read. */
    const currentTarget = (): PostProcessTarget | null =>
        meta.id && audioFilePathRef.current
            ? { meetingId: meta.id, startedAt: meta.timestamp, audioPath: audioFilePathRef.current }
            : null;
    const isProcessingCurrent = !!postProcessing.job && postProcessing.job.meetingId === meta.id;

    // Edits, renames, notes and late results are saved without an explicit call
    useEffect(() => {
        session.scheduleAutosave(recording.isRecording);
    }, [transcript, speakerNames, notes, recording.isRecording, session.scheduleAutosave]);

    const handleImported = useCallback(async (imported: ImportedAudio) => {
        await session.flush();
        // Stored right away: the audio file already exists under its id
        await attachRecordingToMeeting({ meetingId: imported.meetingId, startedAt: imported.startedAt, durationMs: imported.durationSec * 1000, mimeType: imported.mimeType });
        edits.resetScreen();
        session.openMeeting({ id: imported.meetingId, timestamp: imported.startedAt, transcript: [], speakerNames: {}, duration: imported.durationSec, hasAudio: true, audioMimeType: imported.mimeType }, null);
        showAudio(imported.audioPath, imported.durationSec);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, showAudio]);
    const audioImport = useAudioImport({ onImported: handleImported, showToast });

    // ===== Live transcription and speakers =====
    useVoskTranscription({ settings, recording, diarizationRef, setCurrentText, setTranscript });
    const { activeVoskModel, isVoskLoading } = useMeetingInitialization({ settings, speechConfig, showToast });
    useOverlapDetection({ transcript, setTranscript });
    useDiarizationSync(diarizationRef, settings);

    // RAM: Stable Diffusion leaves while the meeting is open; a heavy speech model (Voxtral,
    // Whisper medium/large) frees the LLM when it loads; leaving frees them and restores the LLM
    useEffect(() => {
        void enterActivity('meeting', ['gguf', 'litert', 'genie', 'whisper', 'voxtral']).catch(() => { });
        return () => { void leaveActivity('meeting'); };
    }, []);

    // The app keeps the screen mounted (hidden) while it records or transcribes
    const processingLabel = postProcessing.job ? describeJob(postProcessing.job) : postProcessing.live ? 'Transcribing while recording' : null;
    const isBusyRecording = recording.isRecording || recording.isFinalizing;
    useEffect(() => {
        onBusyChange?.(isBusyRecording || processingLabel
            ? { recording: isBusyRecording, startedAt: recording.isRecording ? meta.timestamp : undefined, processing: processingLabel }
            : null);
    }, [onBusyChange, isBusyRecording, recording.isRecording, processingLabel, meta.timestamp]);

    // Recordings that a crash or a kill left unsaved
    const hasContent = transcript.length > 0 || meta.hasAudio || notes.bookmarks.length > 0;
    const recovery = useRecordingRecovery({
        showToast,
        onRecovered: recovered => {
            if (isBusyRecording || hasContent) return;
            void edits.openSavedMeeting(recovered.meetingId);
        }
    });

    // The open meeting deleted in History or on another device: an autosave must not recreate it
    const handleOpenMeetingDeletedRef = useRef<(meetingId: string) => void>(() => { });
    handleOpenMeetingDeletedRef.current = (meetingId: string) => {
        const result = session.handleMeetingDeleted(meetingId, recording.isRecordingRef.current || recording.isActiveRef.current);
        if (result === 'none') return;
        if (result === 'detached') {
            showToast('This meeting was deleted: the recording continues as a new meeting', 'info');
            return;
        }
        if (isProcessingCurrent) postProcessing.cancel();
        playback.audioRef.current?.pause();
        edits.resetScreen();
        showToast('The open meeting was deleted', 'info');
    };
    useEffect(() => onMeetingDeleted(id => handleOpenMeetingDeletedRef.current(id)), []);

    // ===== Handlers =====
    const handleNewMeeting = async () => {
        if (isBusyRecording) return showToast('Please stop the current recording first', 'info');
        await session.flush();
        edits.startNewMeeting(false);
        setView('transcript');
        showToast(hasContent ? 'New meeting: the previous one is saved in History' : 'New meeting session started', 'success');
    };

    const handleStartRecording = async () => {
        if (recording.isActiveRef.current) return;
        playback.audioRef.current?.pause();
        // Each recording is its own meeting; the one on screen is already saved
        const hadContent = hasContent;
        const meetingId = edits.startNewMeeting(true)!;
        setView('transcript');
        const started = await recording.startRecording(meetingId);
        if (!started) return;
        // Segment timestamps count from the first recorded sample
        if (metaRef.current.id === meetingId) session.updateMeta({ timestamp: started.startedAt });
        if (settings.autoTranscribe && settings.transcribeWhileRecording && settings.transcriptionMode !== 'voxtral' && started.wavPath) {
            postProcessing.startLive({ meetingId, startedAt: started.startedAt, audioPath: '', wavPath: started.wavPath }, transcribeOptionsFrom(settings));
        }
        if (hadContent) showToast('New meeting started: the previous one is saved in History', 'info');
    };

    const handleImportAudio = () => {
        if (isBusyRecording) return showToast('Please stop the current recording first', 'info');
        audioImport.triggerAudioImport();
    };

    const handleTranscribe = async () => {
        const target = currentTarget();
        if (!target) {
            showToast(meta.hasAudio ? 'This meeting has no audio file on this phone (old format, or recorded on another device)' : 'No recorded audio to transcribe', 'info');
            return;
        }
        const editsCount = transcript.filter(t => t.isEdited).length;
        if (editsCount > 0 && !await askConfirm({
            title: 'Replace the transcript?',
            message: `The new transcript replaces the current one, including ${editsCount} manual edit${editsCount === 1 ? '' : 's'}.`,
            confirmLabel: 'Transcribe'
        })) return;
        startTranscriptionRef.current(target);
    };

    const handleIdentifySpeakers = () => {
        const target = currentTarget();
        if (!target) return showToast('No recorded audio to analyze', 'info');
        if (transcript.length === 0) return showToast('No transcript yet: transcribe the audio first', 'info');
        postProcessing.identifySpeakers(target, transcript, speakerOptionsFrom(settings));
    };

    const handleSeek = (ms: number) => playback.seekTo(ms / 1000, true);

    /** A time in the AI notes: play it, and show where it is in the transcript. */
    const handleSeekFromNotes = (ms: number) => {
        // Cited times are whole seconds: "2:58" means the sentence starting within that second
        const index = segmentIndexAt(transcript, ms + 999);
        handleSeek(index >= 0 ? Math.min(ms, transcript[index].start_ms!) : ms);
        if (index >= 0) {
            if (!isWideScreen()) setView('transcript');
            focusSegment(transcript[index].id);
        }
    };

    const handleMarkMoment = async () => {
        let ms: number | null = null;
        if (recording.isRecording) ms = await recording.addBookmark();
        else if (playback.recordedAudioUrl && meta.id) ms = Math.round(playback.currentTime * 1000);
        if (ms === null) return showToast('Nothing to mark: record or play a meeting first', 'info');
        addBookmarks(bookmarksFromPositions([ms]));
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => { });
        showToast(`Moment marked at ${formatClock(ms)}`, 'success');
    };

    /** Opens a saved meeting, optionally at one of its segments (a search result). */
    const handleOpenMeeting = async (meetingId: string, segmentId?: string) => {
        if (meetingId === meta.id) {
            setIsHistoryOpen(false);
            setView('transcript');
            if (segmentId) focusSegment(segmentId);
            return;
        }
        if (isBusyRecording) return showToast('Please stop the current recording first', 'info');
        await session.flush();
        playback.audioRef.current?.pause();
        if (!await edits.openSavedMeeting(meetingId)) return showToast('Could not open this meeting', 'error');
        setView('transcript');
        if (segmentId) setTimeout(() => focusSegment(segmentId), 50); // after the transcript has rendered
        setIsHistoryOpen(false);
    };

    /**
     * Closing (X or Android Back) never drops a recording: it goes on in the background, or is
     * stopped and saved. Overlays close first.
     */
    const requestClose = async () => {
        if (isExportSheetOpen) return setIsExportSheetOpen(false);
        if (isHistoryOpen) return setIsHistoryOpen(false);
        if (recording.isRecordingRef.current) {
            const choice = await askChoice({
                title: 'A meeting is being recorded',
                choices: [
                    { id: 'background', label: 'Keep recording in the background', description: 'Reopen it from the bar at the top of the app' },
                    { id: 'stop', label: 'Stop and save' }
                ]
            });
            if (!choice) return;
            if (choice === 'stop') await recording.stopRecording();
        }
        await session.flush().catch(e => logger.log('error', 'Error while closing the meeting', e));
        onClose();
    };
    const requestCloseRef = useRef(requestClose);
    requestCloseRef.current = requestClose;
    useEffect(() => {
        if (hidden) return;
        return registerBackHandler('meeting', () => { void requestCloseRef.current(); return true; });
    }, [hidden]);

    // ===== Render =====
    const aiJobHere = ai.job && ai.job.meetingId === meta.id ? ai.job : null;
    const notesCount = (notes.analysis ? 1 : 0) + notes.questions.length;
    const playbackMs = playback.recordedAudioUrl && (playback.isPlayingAudio || playback.currentTime > 0) ? playback.currentTime * 1000 : null;
    const canSeek = !!playback.recordedAudioUrl && !recording.isRecording;
    const emptyMessage = recording.isRecording
        ? (settings.transcriptionMode === 'off' ? 'Recording audio only: the transcript is made after the meeting' : 'Listening… the live transcript appears here')
        : meta.id && meta.hasAudio ? 'No transcript yet: use Transcribe (Whisper) below' : 'Press Record to start the meeting';

    return (
        <div className={hidden ? 'hidden' : undefined}>
            <div className="fixed inset-0 bg-background z-50 flex flex-col pt-safe pb-safe">
                <MeetingHeader
                    onClose={() => void requestClose()}
                    onOpenSettings={() => onOpenSettings?.()}
                    onOpenHistory={() => setIsHistoryOpen(true)}
                    onNewMeeting={handleNewMeeting}
                    onImportAudio={handleImportAudio}
                    settings={settings}
                    speechConfig={speechConfig}
                    activeVoskModel={activeVoskModel}
                    isVoskLoading={isVoskLoading}
                    isRecording={isBusyRecording}
                    aiConfigured={ai.isConfigured}
                />

                <RecoveryBanner sessions={recovery.recoverable} busySessionId={recovery.busySessionId} onRecover={recovery.recover} onDiscard={recovery.discard} />

                {meta.id && (
                    <MeetingTitleBar
                        title={recording.isRecording && !notes.title ? 'Recording…' : displayTitle({ timestamp: meta.timestamp, ...notes })}
                        date={notes.title || notes.analysis?.title ? formatMeetingDate(meta.timestamp) : 'Tap to name this meeting'}
                        bookmarkCount={notes.bookmarks.length}
                        notesCount={notesCount}
                        isAIBusy={!!aiJobHere}
                        view={view}
                        onViewChange={setView}
                        onRename={edits.renameMeeting}
                    />
                )}

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                    {!meta.id && showWelcome ? (
                        <WelcomeCard isAIConfigured={ai.isConfigured} onOpenAISettings={() => onOpenSettings?.('llm')} onDismiss={() => setShowWelcome(false)} />
                    ) : <MeetingTranscript
                        key={meta.id ?? 'none'}
                        transcript={transcript}
                        currentText={currentText}
                        speakerNames={speakerNames}
                        bookmarks={notes.bookmarks}
                        onSpeakerMenu={edits.openSpeakerMenu}
                        onSegmentEdit={isProcessingCurrent ? undefined : edits.editSegment}
                        onSeek={canSeek ? handleSeek : undefined}
                        onBookmarkSelect={canSeek ? b => handleSeek(bookmarkPlaybackStart(transcript, b)) : undefined}
                        onRemoveBookmark={recording.isRecording ? undefined : edits.removeBookmark}
                        playbackMs={canSeek ? playbackMs : null}
                        isPlaying={playback.isPlayingAudio}
                        isLive={recording.isRecording}
                        focus={focus}
                        emptyMessage={emptyMessage}
                        isProcessing={isProcessingCurrent || recording.isFinalizing}
                        processingStatus={recording.isFinalizing ? 'Saving recording...' : isProcessingCurrent ? describeJob(postProcessing.job) : ''}
                        onCancelProcessing={isProcessingCurrent ? postProcessing.cancel : undefined}
                        className={meta.id && view === 'notes' ? 'hidden md:block' : ''}
                    />}

                    {meta.id && view === 'notes' && (
                        <MeetingNotesPanel
                            analysis={notes.analysis}
                            questions={notes.questions}
                            bookmarkCount={notes.bookmarks.length}
                            job={aiJobHere}
                            isBusyElsewhere={!!ai.job && !aiJobHere}
                            isConfigured={ai.isConfigured}
                            canAnalyzeAudio={!!playback.recordedAudioUrl && supportsTaskAudio(llmConfig, serverSettings) && !recording.isRecording}
                            hasTranscript={transcript.length > 0}
                            onAnalyze={source => { const ctx = currentContext(); if (ctx) ai.analyze(ctx, source); }}
                            onAsk={question => { const ctx = currentContext(); if (ctx) ai.ask(ctx, question); }}
                            onCancel={ai.cancel}
                            onDeleteQuestion={edits.deleteQuestion}
                            onOpenSettings={() => onOpenSettings?.('llm')}
                            onSeek={canSeek ? handleSeekFromNotes : undefined}
                            className="md:w-2/5 md:flex-none md:border-l md:border-surface"
                        />
                    )}
                </div>

                <MeetingControls
                    isRecording={recording.isRecording}
                    isPaused={recording.isPaused}
                    isLoading={recording.isFinalizing}
                    subscribeLevel={recording.subscribeLevel}
                    liveTranscribedMs={postProcessing.live?.meetingId === meta.id ? postProcessing.live.transcribedMs : null}
                    onStartRecording={handleStartRecording}
                    onStopRecording={recording.stopRecording}
                    onTogglePause={recording.togglePause}
                    onMarkMoment={handleMarkMoment}
                    bookmarkCount={notes.bookmarks.length}
                    onImportAudio={handleImportAudio}
                    playback={playback}
                    transcriptLength={transcript.length}
                    isPostProcessing={!!postProcessing.job}
                    onTranscribe={handleTranscribe}
                    onIdentifySpeakers={handleIdentifySpeakers}
                    onExport={() => (transcript.length === 0 && !playback.recordedAudioUrl
                        ? showToast('Nothing to export yet', 'info')
                        : setIsExportSheetOpen(true))}
                />
            </div>

            <Toast message={toast.message} isVisible={toast.isVisible} onClose={() => setToast(prev => ({ ...prev, isVisible: false }))} type={toast.type} />

            <MeetingHistory
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                onOpenMeeting={handleOpenMeeting}
                onDeleted={id => handleOpenMeetingDeletedRef.current(id)}
                currentMeetingId={currentMeetingId}
                recordingMeetingId={isBusyRecording ? currentMeetingId : null}
            />

            {isExportSheetOpen && <ExportBottomSheet
                isOpen={isExportSheetOpen}
                onClose={() => setIsExportSheetOpen(false)}
                transcript={transcript}
                speakerNames={speakerNames}
                notes={notes ?? EMPTY_NOTES}
                meeting={meta.id ? {
                    id: meta.id,
                    timestamp: meta.timestamp,
                    duration: meta.duration,
                    hasAudio: meta.hasAudio && !recording.isRecording && !!playback.recordedAudioUrl,
                    audioMimeType: meta.audioMimeType
                } : undefined}
            />}

            <input
                type="file"
                ref={audioImport.fileInputRef}
                onChange={audioImport.handleFileSelected}
                accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.flac"
                className="hidden"
            />
        </div>
    );
};

export default MeetingMode;
