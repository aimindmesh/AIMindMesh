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
import { saveMeeting as saveMeetingToStorage, getMeetingAudioFile } from '../../services/meeting/meetingStorage';



import { useMeetingSettings } from '../../hooks/meeting/useMeetingSettings';
import { useAudioPlayback } from '../../hooks/meeting/useAudioPlayback';
import { useMeetingRecording } from '../../hooks/meeting/useMeetingRecording';
import { useMeetingAnalysis } from '../../hooks/meeting/useMeetingAnalysis';
import { useMeetingReprocessing } from '../../hooks/meeting/useMeetingReprocessing';
import { useVoskTranscription } from '../../hooks/meeting/useVoskTranscription';
import { useWhisperTranscription } from '../../hooks/meeting/useWhisperTranscription';
import { useMeetingInitialization } from '../../hooks/meeting/useMeetingInitialization';

import { segmentAudioService } from '../../services/meeting/SegmentAudioService';
import { MeetingHeader, MeetingTranscript, MeetingAnalysisPanel, MeetingControls, ExportBottomSheet } from '.';
import MeetingHistory from './MeetingHistory';
import AudioMiniPlayer from './AudioMiniPlayer';
import Toast from '../ui/Toast';

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
    const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
    const [currentText, setCurrentText] = useState('');
    const [speakerNames, setSpeakerNames] = useState<Record<number, string>>({});
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
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

    // Ref to holds the raw PCM blob for reprocessing (bypassing potentially buggy decoding)
    const pcmAudioBlobRef = useRef<Blob | null>(null);
    const audioFilePathRef = useRef<string | null>(null);

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

    // Ref to break circular dependency with saveMeeting
    const saveMeetingRef = useRef<() => Promise<void>>(async () => { });

    // Ref refs
    const transcriptionModeRef = useRef(settings.transcriptionMode);
    useEffect(() => {
        transcriptionModeRef.current = settings.transcriptionMode;
    }, [settings.transcriptionMode]);



    const handleRecordingStopped = useCallback(async (audioChunks: Blob[], mimeType: string, pcmBlob?: Blob | null, durationMs?: number, filePath?: string) => {
        try {
            // New optimized path: Streaming to file
            if (filePath) {
                audioFilePathRef.current = filePath;
                const audioUrl = Capacitor.convertFileSrc(filePath);
                playback.setRecordedAudioUrl(audioUrl);
                logger.log('info', `Set playback URL from file: ${filePath}`);

                if (durationMs && durationMs > 0) {
                    playback.setAudioDuration(durationMs / 1000);
                }
            }
            // Prefer pcmBlob (WAV from AudioWorklet) over audioChunks (legacy MediaRecorder)
            else if (pcmBlob && pcmBlob.size > 0) {
                // New AudioWorklet path: use the WAV blob directly
                const audioUrl = URL.createObjectURL(pcmBlob);
                playback.setRecordedAudioUrl(audioUrl);
                logger.log('info', `Created playback URL from WAV blob: ${pcmBlob.size} bytes`);

                // Use passed duration or calculate from blob size
                if (durationMs && durationMs > 0) {
                    playback.setAudioDuration(durationMs / 1000);
                }
            } else if (audioChunks.length > 0) {
                // Legacy MediaRecorder path (fallback)
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                const audioUrl = URL.createObjectURL(audioBlob);
                playback.setRecordedAudioUrl(audioUrl);

                // Use passed duration or 0
                if (durationMs && durationMs > 0) {
                    playback.setAudioDuration(durationMs / 1000);
                }
            }

            // Store pcmBlob reference for reprocessing (still needed if not using file)
            // If we have file, we might not have pcmBlob populated if we disabled accumulation
            pcmAudioBlobRef.current = pcmBlob || null;

            if (pcmBlob) {
                logger.log('info', `Received raw PCM blob for reprocessing: ${pcmBlob.size} bytes`);
            }

            // Auto-save via ref to break cycle
            if (saveMeetingRef.current) {
                await saveMeetingRef.current();
            }
        } catch (error) {
            logger.log('error', 'Error handling stopped recording', error);
            showToast('Error saving recording', 'error');
        }
    }, [playback, showToast]);

    const recording = useMeetingRecording({
        recognitionModeRef: settings.recognitionModeRef,
        transcriptionModeRef,
        showToast,
        onRecordingStopped: handleRecordingStopped
    });

    const saveMeeting = useCallback(async () => {
        const hasTranscript = transcript.length > 0;
        const hasLegacyAudio = recording.audioChunksRef.current.length > 0;
        const hasWavAudio = !!pcmAudioBlobRef.current;
        const hasAudio = hasLegacyAudio || hasWavAudio;

        if (!hasTranscript && !hasAudio) {
            logger.log('info', 'No transcript or audio to save');
            return;
        }

        try {
            const meetingId = currentMeetingId || Date.now().toString();
            if (!currentMeetingId && (playback.recordedAudioUrl || hasAudio)) {
                setCurrentMeetingId(meetingId);
            }

            // Prepare audio chunks for storage (legacy expects array of blobs)
            let audioForStorage: Blob[] | undefined;
            if (hasWavAudio && pcmAudioBlobRef.current) {
                audioForStorage = [pcmAudioBlobRef.current];
            } else if (hasLegacyAudio) {
                audioForStorage = recording.audioChunksRef.current;
            }

            await saveMeetingToStorage({
                id: meetingId,
                timestamp: Date.now(),
                transcript,
                speakerNames,
                duration: playback.audioDuration,
                hasAudio: !!audioForStorage || !!playback.recordedAudioUrl
            }, audioForStorage, undefined, audioFilePathRef.current || undefined);

        } catch (error) {
            logger.log('error', 'Failed to save meeting', error);
        }
    }, [transcript, recording.audioChunksRef, currentMeetingId, playback.recordedAudioUrl, playback.audioDuration, speakerNames]);

    const analysis = useMeetingAnalysis({
        transcript,
        speakerNames,
        playback,
        llmConfig,
        personality,
        memories,
        apiKey,
        showToast
    });

    const reprocessing = useMeetingReprocessing({
        playback,
        speechConfig,
        transcript,
        setTranscript,
        diarizationRef,
        settings,
        showToast,
        saveMeeting,
        pcmAudioBlobRef,
        audioFilePathRef
    });

    // Update ref for circular dependency handling
    useEffect(() => {
        saveMeetingRef.current = saveMeeting;
    }, [saveMeeting]);

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
        setIsWhisperTranscribing
    });

    const { isModelLoading } = useMeetingInitialization({
        settings,
        showToast,
        transcript,
        currentText
    });

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

    // Memory Management: Unload LLM if Voxtral is active
    useEffect(() => {
        if (speechConfig?.sttProvider === 'voxtral') {
            import('../../services/llm/llmService').then(({ unloadCurrentModel }) => {
                unloadCurrentModel(llmConfig);
            });
        }
    }, [speechConfig?.sttProvider, llmConfig]);


    // ===== Handlers =====

    const handleStartRecording = async () => {
        // Unload LLM if Voxtral is active to free memory
        if (speechConfig?.sttProvider === 'voxtral') {
            try {
                const { unloadCurrentModel } = await import('../../services/llm/llmService');
                await unloadCurrentModel(llmConfig);
            } catch (e) {
                logger.log('error', 'Failed to unload LLM before recording', e);
            }
        }
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
        if (transcript.length === 0) {
            showToast('No transcript to export', 'info');
            return;
        }
        setIsExportSheetOpen(true);
    };

    const handleSegmentPlay = async (segment: TranscriptSegment) => {
        // If the current meeting doesn't have a saved audio file yet (is ongoing without file)
        // or we don't have start_ms, we can't play it
        if (!audioFilePathRef.current || segment.start_ms === undefined || segment.end_ms === undefined) {
            showToast('Audio file not ready for this segment', 'info');
            return;
        }

        const currentState = segmentAudioService.getState();
        if (currentState.activeSegmentId === segment.id && currentState.state === 'playing') {
            await segmentAudioService.pause();
        } else if (currentState.activeSegmentId === segment.id && currentState.state === 'paused') {
            await segmentAudioService.resume();
        } else {
            await segmentAudioService.playSegment(
                segment.id,
                audioFilePathRef.current,
                segment.start_ms,
                segment.end_ms
            );
        }
    };

    const handleSegmentEdit = (segment: TranscriptSegment, newText: string) => {
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

        // Save the updated transcript
        if (saveMeetingRef.current) {
            saveMeetingRef.current();
        }
    };

    const handleHistoryReprocess = async (meeting: SavedMeeting) => {
        let hasAudio = false;

        // Try to load optimized audio file first
        try {
            const audioFile = await getMeetingAudioFile(meeting.id);
            if (audioFile && audioFile.path) {
                // Set the file path for reprocessing
                audioFilePathRef.current = audioFile.path;

                // Convert to playback URL
                const audioUrl = Capacitor.convertFileSrc(audioFile.path);
                playback.setRecordedAudioUrl(audioUrl);

                hasAudio = true;
                logger.log('info', `Loaded optimized audio file for meeting ${meeting.id}`);
            }
        } catch (e) {
            logger.log('warn', 'Failed to load optimized audio file', e);
        }

        // Fallback to legacy audio data if no file found
        if (!hasAudio && meeting.audioData && meeting.audioMimeType) {
            try {
                const binaryString = atob(meeting.audioData);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: meeting.audioMimeType });
                const url = URL.createObjectURL(blob);

                playback.setRecordedAudioUrl(url);
                audioFilePathRef.current = null; // No file path for legacy
                pcmAudioBlobRef.current = null; // No raw PCM available

                hasAudio = true;
                logger.log('info', 'Loaded legacy audio data');
            } catch (e) {
                logger.log('error', 'Failed to load legacy audio data', e);
            }
        }

        if (hasAudio) {
            setCurrentMeetingId(meeting.id);
            setSpeakerNames(meeting.speakerNames || {});
            setTranscript(meeting.transcript || []);
            setIsHistoryOpen(false);
            showToast('Meeting loaded. Press "Reprocess Audio" to process.', 'info');
        } else {
            showToast('This meeting has no saved audio.', 'error');
        }
    };

    // ===== Render =====
    return (
        <>
            <div className="fixed inset-0 bg-background z-50 flex flex-col pt-safe pb-safe">
                <MeetingHeader
                    onClose={onClose}
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
                    isLoading={isModelLoading}
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

            <ExportBottomSheet
                isOpen={isExportSheetOpen}
                onClose={() => setIsExportSheetOpen(false)}
                transcript={transcript}
                speakerNames={speakerNames}
            />
        </>
    );
};

export default MeetingMode;
