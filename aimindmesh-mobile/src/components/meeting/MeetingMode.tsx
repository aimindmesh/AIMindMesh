/**
 * MeetingMode - Meeting recording and transcription assistant
 * 
 * Refactored into smaller pieces:
 * - hooks/meeting/useMeetingSettings - Settings persistence
 * - hooks/meeting/useAudioPlayback - Audio playback controls
 * - hooks/meeting/useMeetingRecording - Recording with Vosk
 * - hooks/meeting/useMeetingAnalysis - LLM Analysis
 * - hooks/meeting/useMeetingReprocessing - Audio reprocessing and diarization
 * - hooks/meeting/useVoskTranscription - Vosk listeners and ONNX embedding
 * - hooks/meeting/useWhisperTranscription - Whisper loop
 * - hooks/meeting/useMeetingInitialization - Init and model loading
 * - services/meeting/meetingStorage - Storage and export
 * - components/meeting/* - UI subcomponents
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

import { LLMConfig, Memory, SpeechConfig } from '../../types';
import { TranscriptSegment, SavedMeeting } from '../../types/meeting';

import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { logger } from '../../services/logger';
import { resolveMeetingAudio } from '../../services/meeting/meetingStorage';
import { registerBackHandler } from '../../services/native/backButtonRegistry';
import { onMeetingDeleted } from '../../services/meeting/meetingDeletions';
import { describeRecoveredRecording, recoverInterruptedRecordings } from '../../services/meeting/recordingRecovery';

import { useMeetingSettings } from '../../hooks/meeting/useMeetingSettings';
import { useAudioPlayback } from '../../hooks/meeting/useAudioPlayback';
import { useMeetingRecording, RecordingStopResult } from '../../hooks/meeting/useMeetingRecording';
import { useMeetingSession } from '../../hooks/meeting/useMeetingSession';
import { useMeetingAnalysis } from '../../hooks/meeting/useMeetingAnalysis';
import { useMeetingReprocessing } from '../../hooks/meeting/useMeetingReprocessing';
import { useVoskTranscription } from '../../hooks/meeting/useVoskTranscription';
import { useWhisperTranscription } from '../../hooks/meeting/useWhisperTranscription';
import { useOverlapDetection } from '../../hooks/meeting/useOverlapDetection';
import { useHybridTranscription } from '../../hooks/meeting/useHybridTranscription';
import { useMeetingInitialization } from '../../hooks/meeting/useMeetingInitialization';

import { segmentAudioService } from '../../services/meeting/SegmentAudioService';
import { hasSegmentTiming } from '../../services/speaker/segmentAssignment';
import { MeetingHeader, MeetingTranscript, MeetingAnalysisPanel, MeetingControls, ExportBottomSheet } from '.';
import MeetingHistory from './MeetingHistory';
import AudioMiniPlayer from './AudioMiniPlayer';
import Toast from '../ui/Toast';
import { enterActivity, leaveActivity } from '../../services/model/modelOrchestrator';

interface MeetingModeProps {
    onClose: () => void;
    personality: any;
    llmConfig: LLMConfig;
    apiKey?: string;
    memories?: Memory[];
    speechConfig?: SpeechConfig;
}

const MeetingMode: React.FC<MeetingModeProps> = ({ onClose, personality, llmConfig, apiKey, memories, speechConfig }) => {
    // ===== State =====
    const [currentText, setCurrentText] = useState('');
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [toast, setToast] = useState<{ message: string; isVisible: boolean; type: 'success' | 'error' | 'info' }>({
        message: '',
        isVisible: false,
        type: 'success'
    });
    const [isWhisperTranscribing, setIsWhisperTranscribing] = useState(false);
    const [isExportSheetOpen, setIsExportSheetOpen] = useState(false);

    // ===== Refs =====
    const diarizationRef = useRef<SpeakerDiarization>(new SpeakerDiarization());
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const closingRef = useRef(false);

    // Audio Playback state tracking
    const [segmentAudioState, setSegmentAudioState] = useState(segmentAudioService.getState());

    useEffect(() => {
        const unsubscribe = segmentAudioService.subscribe((state, segmentId) => {
            setSegmentAudioState({ state, activeSegmentId: segmentId });
        });
        return unsubscribe;
    }, []);

    // ===== Custom Hooks =====
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, isVisible: true, type });
    }, []);

    const settings = useMeetingSettings();
    const playback = useAudioPlayback({ showToast });
    // Transcript, names, meeting id and saving (always from the latest values)
    const session = useMeetingSession(showToast);
    const { transcript, setTranscript, speakerNames, setSpeakerNames, audioFilePathRef, pcmAudioBlobRef } = session;
    const { setRecordedAudioUrl, setAudioDuration } = playback;

    const transcriptionModeRef = useRef(settings.transcriptionMode);
    useEffect(() => {
        transcriptionModeRef.current = settings.transcriptionMode;
    }, [settings.transcriptionMode]);

    const handleRecordingStopped = useCallback(async ({ filePath, pcmBlob, durationMs }: RecordingStopResult) => {
        try {
            // The recording is moved into meeting storage: play it from there
            const storedPath = await session.attachRecording(filePath, pcmBlob, durationMs);
            if (storedPath) {
                setRecordedAudioUrl(Capacitor.convertFileSrc(storedPath));
            } else if (pcmBlob && pcmBlob.size > 0) {
                setRecordedAudioUrl(URL.createObjectURL(pcmBlob));
            } else {
                showToast('The audio could not be saved: the transcript is kept', 'error');
            }
            if (durationMs > 0) setAudioDuration(durationMs / 1000);
            await session.save();
        } catch (error) {
            logger.log('error', 'Error handling stopped recording', error);
            showToast('Error saving recording', 'error');
        }
    }, [session.attachRecording, session.save, setRecordedAudioUrl, setAudioDuration, showToast]);

    const recording = useMeetingRecording({
        recognitionModeRef: settings.recognitionModeRef,
        transcriptionModeRef,
        showToast,
        onRecordingStopped: handleRecordingStopped,
        setTranscript,
        diarizationRef,
        getMeetingId: session.getMeetingId
    });

    const analysis = useMeetingAnalysis({
        transcript,
        speakerNames,
        playback,
        audioFilePathRef,
        llmConfig,
        personality,
        memories,
        apiKey,
        showToast
    });

    const reprocessing = useMeetingReprocessing({
        playback,
        speechConfig,
        getTranscript: session.getTranscript,
        setTranscript,
        getMeetingTimestamp: session.getMeetingTimestamp,
        diarizationRef,
        settings,
        showToast,
        saveMeeting: session.save,
        suspendAutosave: session.suspendAutosave,
        pcmAudioBlobRef,
        audioFilePathRef
    });

    // Edits, renames and late results are saved without an explicit call
    useEffect(() => {
        session.scheduleAutosave(recording.isRecording);
    }, [transcript, speakerNames, recording.isRecording, session.scheduleAutosave]);

    // ===== Sub-Hooks for Transcriptions =====
    useVoskTranscription({
        settings,
        recording,
        reprocessing,
        diarizationRef,
        setCurrentText,
        setTranscript
    });

    useWhisperTranscription({
        settings,
        recording,
        setTranscript,
        setIsWhisperTranscribing,
        diarizationRef,
        recognitionModeRef: settings.recognitionModeRef
    });

    useHybridTranscription({
        settings,
        recording,
        transcript,
        setTranscript
    });

    const { isModelLoading } = useMeetingInitialization({ settings, showToast });

    // Overlap detection: marks segments where two speakers talk simultaneously
    useOverlapDetection({ transcript, setTranscript });

    // ===== Effects =====

    // Sync diarization sensitivity
    useEffect(() => {
        diarizationRef.current.setSimilarityThreshold(settings.diarizationSensitivity);
    }, [settings.diarizationSensitivity]);

    // Sync temporal smoothing
    useEffect(() => {
        diarizationRef.current.setMinTimeBetweenSwitches(settings.temporalSmoothing);
    }, [settings.temporalSmoothing]);

    // Sync advanced diarization settings
    useEffect(() => {
        diarizationRef.current.setEmbeddingThreshold(settings.embeddingThreshold);
    }, [settings.embeddingThreshold]);

    useEffect(() => {
        diarizationRef.current.setRejectionThreshold(settings.embeddingRejectionThreshold);
    }, [settings.embeddingRejectionThreshold]);

    useEffect(() => {
        diarizationRef.current.setAdaptationRate(settings.embeddingAdaptationRate);
    }, [settings.embeddingAdaptationRate]);

    useEffect(() => {
        diarizationRef.current.setMinEmbeddingMagnitude(settings.minEmbeddingMagnitude);
    }, [settings.minEmbeddingMagnitude]);

    // Scroll to bottom
    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, currentText]);

    // RAM: Stable Diffusion leaves while the meeting is open; a heavy speech model (Voxtral,
    // Whisper medium/large) frees the LLM when it loads; closing frees them and restores the LLM
    useEffect(() => {
        void enterActivity('meeting', ['gguf', 'litert', 'genie', 'whisper', 'voxtral']).catch(() => { });
        return () => { void leaveActivity('meeting'); };
    }, []);

    // ===== Handlers =====

    /**
     * Closing (X or Android Back) never drops a recording: it asks, stops, finishes the file and
     * saves before leaving. Overlays close first.
     */
    const requestClose = async () => {
        if (closingRef.current) return;
        if (isExportSheetOpen) return setIsExportSheetOpen(false);
        if (isHistoryOpen) return setIsHistoryOpen(false);
        if ((recording.isRecordingRef.current || recording.isBusyRef.current) &&
            !window.confirm('A meeting is being recorded. Stop the recording, save it and close?')) return;
        if (reprocessing.isReclustering) {
            if (!window.confirm('Processing is still running. Close anyway? The meeting keeps its previous transcript.')) return;
            reprocessing.handleCancelProcessing();
        }
        closingRef.current = true;
        try {
            await recording.stopRecording();
            await session.flush();
        } catch (error) {
            logger.log('error', 'Error while closing the meeting', error);
        } finally {
            onClose();
        }
    };
    const requestCloseRef = useRef(requestClose);
    requestCloseRef.current = requestClose;

    useEffect(() => registerBackHandler('meeting', () => {
        void requestCloseRef.current();
        return true;
    }), []);

    // The open meeting deleted in History or on another device: an autosave must not recreate it
    const handleOpenMeetingDeletedRef = useRef<(meetingId: string) => void>(() => { });
    handleOpenMeetingDeletedRef.current = (meetingId: string) => {
        const result = session.handleMeetingDeleted(meetingId, recording.isRecordingRef.current || recording.isBusyRef.current);
        if (result === 'none') return;
        if (result === 'detached') {
            showToast('This meeting was deleted: the recording continues as a new meeting', 'info');
            return;
        }
        if (reprocessing.isReclustering) reprocessing.handleCancelProcessing();
        void segmentAudioService.stop();
        diarizationRef.current.clear();
        setCurrentText('');
        setRecordedAudioUrl(null);
        setAudioDuration(0);
        showToast('The open meeting was deleted', 'info');
    };
    useEffect(() => onMeetingDeleted(id => handleOpenMeetingDeletedRef.current(id)), []);

    // Recordings cut short by the app being killed are recovered and announced once
    useEffect(() => {
        let cancelled = false;
        recoverInterruptedRecordings()
            .then(recovered => {
                if (cancelled || recovered.length === 0) return;
                const message = recovered.map(r => describeRecoveredRecording(r)).join('\n');
                showToast(message, 'success');
            })
            .catch(e => logger.log('warn', 'Recovery of interrupted recordings failed', e));
        return () => { cancelled = true; };
    }, [showToast]);

    const handleStartRecording = async () => {
        if (recording.isRecordingRef.current || recording.isBusyRef.current || reprocessing.isReclustering) return;
        // Every recording is a new meeting (the previous one is already saved)
        session.beginNewMeeting();
        diarizationRef.current.clear();
        setCurrentText('');
        setRecordedAudioUrl(null);
        setAudioDuration(0);
        await recording.startRecording();
    };

    const handleRenameSpeaker = (speakerId: number) => {
        const currentName = speakerNames[speakerId] || `Speaker ${speakerId + 1}`;
        const newName = prompt('Speaker Name:', currentName);
        if (newName && newName.trim()) {
            setSpeakerNames(prev => ({ ...prev, [speakerId]: newName.trim() }));
        }
    };

    const handleExport = async () => {
        if (transcript.length === 0 && !session.meta.hasAudio) {
            showToast('No transcript to export', 'info');
            return;
        }
        setIsExportSheetOpen(true);
    };

    const handleSegmentPlay = async (segment: TranscriptSegment) => {
        // Needs the saved audio file and the segment's position in it
        if (!audioFilePathRef.current || !hasSegmentTiming(segment)) {
            showToast('Audio file not ready for this segment', 'info');
            return;
        }

        try {
            const currentState = segmentAudioService.getState();
            if (currentState.activeSegmentId === segment.id && currentState.state === 'playing') {
                await segmentAudioService.pause();
            } else if (currentState.activeSegmentId === segment.id && currentState.state === 'paused') {
                await segmentAudioService.resume();
            } else {
                await segmentAudioService.playSegment(segment.id, audioFilePathRef.current, segment.start_ms, segment.end_ms);
            }
        } catch (error) {
            showToast('Could not play this segment', 'error');
        }
    };

    const handleSegmentEdit = (segment: TranscriptSegment, newText: string) => {
        // Autosave persists it (an explicit save here used to write the pre-edit transcript)
        setTranscript(prev => prev.map(t => {
            if (t.id === segment.id) {
                return {
                    ...t,
                    text: newText,
                    originalText: t.originalText || t.text,
                    isEdited: true,
                    editedAt: Date.now()
                };
            }
            return t;
        }));
    };

    const handleHistoryReprocess = async (meeting: SavedMeeting) => {
        if (recording.isRecordingRef.current || recording.isBusyRef.current || reprocessing.isReclustering) {
            showToast('Stop the recording before opening another meeting', 'info');
            return;
        }
        let audio: { url: string; filePath: string | null } | null = null;
        try {
            audio = await resolveMeetingAudio(meeting);
        } catch (e) {
            logger.log('warn', 'Failed to load the meeting audio', e);
        }
        const audioUrl = audio?.url ?? null;

        if (!audioUrl) {
            showToast('This meeting has no saved audio.', 'error');
            return;
        }
        session.openMeeting(meeting, audio?.filePath ?? null);
        diarizationRef.current.clear();
        setRecordedAudioUrl(audioUrl);
        setAudioDuration(meeting.duration || 0);
        setIsHistoryOpen(false);
        showToast('Meeting loaded. Press "Reprocess Audio" to process.', 'info');
    };

    // ===== Render =====
    return (
        <>
            <div className="fixed inset-0 bg-background z-50 flex flex-col pt-safe pb-safe">
                <MeetingHeader
                    onClose={() => void requestClose()}
                    isRecording={recording.isRecording || recording.isBusy}
                    onOpenHistory={() => setIsHistoryOpen(true)}
                    recognitionMode={settings.recognitionMode}
                    setRecognitionMode={settings.setRecognitionMode}
                    speechConfig={speechConfig}
                    diarizationSensitivity={settings.diarizationSensitivity}
                    setDiarizationSensitivity={settings.setDiarizationSensitivity}
                    temporalSmoothing={settings.temporalSmoothing}
                    setTemporalSmoothing={settings.setTemporalSmoothing}
                    embeddingDuration={settings.embeddingDuration}
                    setEmbeddingDuration={settings.setEmbeddingDuration}
                    targetSpeakerCount={settings.targetSpeakerCount}
                    setTargetSpeakerCount={settings.setTargetSpeakerCount}
                    clusteringAlgorithm={settings.clusteringAlgorithm}
                    setClusteringAlgorithm={settings.setClusteringAlgorithm}
                    transcriptionLanguage={settings.transcriptionLanguage}
                    setTranscriptionLanguage={settings.setTranscriptionLanguage}
                    transcriptionMode={settings.transcriptionMode}
                    setTranscriptionMode={settings.setTranscriptionMode}
                    whisperChunkSize={settings.whisperChunkSize}
setWhisperChunkSize={settings.setWhisperChunkSize}
                        whisperVadFilter={settings.whisperVadFilter}
                        setWhisperVadFilter={settings.setWhisperVadFilter}
                        whisperConditionOnPrevious={settings.whisperConditionOnPrevious}
                        setWhisperConditionOnPrevious={settings.setWhisperConditionOnPrevious}
                        whisperWordTimestamps={settings.whisperWordTimestamps}
                        setWhisperWordTimestamps={settings.setWhisperWordTimestamps}
                        whisperProfile={settings.whisperProfile}
                        setWhisperProfile={settings.setWhisperProfile}
                        // Advanced Diarization
                    embeddingThreshold={settings.embeddingThreshold}
                    setEmbeddingThreshold={settings.setEmbeddingThreshold}
                    embeddingRejectionThreshold={settings.embeddingRejectionThreshold}
                    setEmbeddingRejectionThreshold={settings.setEmbeddingRejectionThreshold}
                    embeddingAdaptationRate={settings.embeddingAdaptationRate}
                    setEmbeddingAdaptationRate={settings.setEmbeddingAdaptationRate}
                    minEmbeddingMagnitude={settings.minEmbeddingMagnitude}
                    setMinEmbeddingMagnitude={settings.setMinEmbeddingMagnitude}
                />

                <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                    <MeetingTranscript
                        transcript={transcript}
                        currentText={currentText}
                        speakerNames={speakerNames}
                        onRenameSpeaker={handleRenameSpeaker}
                        transcriptEndRef={transcriptEndRef}
                        showAnalysis={analysis.showAnalysis}
                        isProcessing={analysis.isAnalyzing || reprocessing.isReclustering || isWhisperTranscribing}
                        processingStatus={
                            isWhisperTranscribing
                                ? 'Whisper transcribing...'
                                : reprocessing.processingStatus
                        }
                        onSegmentPlay={handleSegmentPlay}
                        onSegmentEdit={handleSegmentEdit}
                        activeSegmentId={segmentAudioState.activeSegmentId}
                        isPlaying={segmentAudioState.state === 'playing'}
                    />

                    <MeetingAnalysisPanel
                        showAnalysis={analysis.showAnalysis}
                        setShowAnalysis={analysis.setShowAnalysis}
                        isAnalyzing={analysis.isAnalyzing}
                        analysisResult={analysis.analysisResult}
                    />
                </div>

                <MeetingControls
                    isRecording={recording.isRecording}
                    isPaused={recording.isPaused}
                    isLoading={isModelLoading || recording.isBusy}
                    audioLevel={recording.audioLevel}
                    onStartRecording={handleStartRecording}
                    onStopRecording={recording.stopRecording}
                    onTogglePause={recording.togglePause}
                    recordedAudioUrl={playback.recordedAudioUrl}
                    isPlayingAudio={playback.isPlayingAudio}
                    currentTime={playback.currentTime}
                    audioDuration={playback.audioDuration}
                    onTogglePlayback={playback.togglePlayback}
                    onSkipForward={playback.skipForward}
                    onSkipBackward={playback.skipBackward}
                    formatTime={playback.formatTime}
                    audioRef={playback.audioRef}
                    onTimeUpdate={playback.handleTimeUpdate}
                    onLoadedMetadata={playback.handleLoadedMetadata}
                    onAudioEnded={playback.handleAudioEnded}
                    onAudioError={playback.handleAudioError}
                    transcriptLength={transcript.length}
                    isAnalyzing={analysis.isAnalyzing}
                    isReclustering={reprocessing.isReclustering}
                    onReprocessMeeting={reprocessing.reprocessMeeting}
                    onRecluster={playback.recordedAudioUrl ? reprocessing.fullAudioDiarization : reprocessing.reclusterSpeakers}
                    onAnalyzeText={analysis.handleAnalyze}
                    onAnalyzeAudio={analysis.handleAnalyzeAudio}
                    onExport={handleExport}
                />

                <div className="absolute bottom-0 left-0 right-0 z-50 pointer-events-auto">
                    <AudioMiniPlayer />
                </div>
            </div>

            <Toast
                message={toast.message}
                isVisible={toast.isVisible}
                onClose={() => setToast(prev => ({ ...prev, isVisible: false }))}
                type={toast.type}
            />

            <MeetingHistory
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                onReprocess={handleHistoryReprocess}
            />

            {isExportSheetOpen && <ExportBottomSheet
                isOpen={isExportSheetOpen}
                onClose={() => setIsExportSheetOpen(false)}
                transcript={transcript}
                speakerNames={speakerNames}
                meeting={session.meta.id ? {
                    id: session.meta.id,
                    timestamp: session.meta.timestamp,
                    duration: session.meta.duration,
                    hasAudio: session.meta.hasAudio && !recording.isRecording,
                    audioMimeType: session.meta.audioMimeType
                } : undefined}
            />}
        </>
    );
};

export default MeetingMode;
