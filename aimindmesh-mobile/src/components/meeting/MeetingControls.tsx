import React from 'react';
import {
    PauseIcon,
    PlayIcon,
    SparklesIcon,
    SaveIcon,
    Forward10Icon,
    Backward10Icon
} from '../../constants';

interface MeetingControlsProps {
    // Recording state
    isRecording: boolean;
    isPaused: boolean;
    audioLevel: number;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onTogglePause: () => void;
    // Playback state
    recordedAudioUrl: string | null;
    isPlayingAudio: boolean;
    currentTime: number;
    audioDuration: number;
    onTogglePlayback: () => void;
    onSkipForward: () => void;
    onSkipBackward: () => void;
    formatTime: (seconds: number) => string;
    // Audio element props
    audioRef: React.RefObject<HTMLAudioElement>;
    onTimeUpdate: () => void;
    onLoadedMetadata: () => void;
    onAudioEnded: () => void;
    onAudioError: (e: any) => void;
    // Actions
    transcriptLength: number;
    isAnalyzing: boolean;
    isReclustering: boolean;
    onReprocessMeeting: () => void;
    onRecluster: () => void;
    onAnalyzeText: () => void;
    onAnalyzeAudio: () => void;
    onExport: () => void;
    isLoading?: boolean;
}

const MeetingControls: React.FC<MeetingControlsProps> = ({
    isRecording,
    isPaused,
    audioLevel,
    onStartRecording,
    onStopRecording,
    onTogglePause,
    recordedAudioUrl,
    isPlayingAudio,
    currentTime,
    audioDuration,
    onTogglePlayback,
    onSkipForward,
    onSkipBackward,
    formatTime,
    audioRef,
    onTimeUpdate,
    onLoadedMetadata,
    onAudioEnded,
    onAudioError,
    transcriptLength,
    isAnalyzing,
    isReclustering,
    onReprocessMeeting,
    onRecluster,
    onAnalyzeText,
    onAnalyzeAudio,
    onExport,
    isLoading = false
}) => {
    return (
        <footer className="p-6 border-t border-surface bg-surface/20 backdrop-blur-md">
            {/* Audio Playback Controls - Show when not recording and has audio OR transcript */}
            {!isRecording && (recordedAudioUrl || transcriptLength > 0) && (
                <div className="mb-6">
                    <div className="flex items-center justify-center gap-4 mb-3">
                        <button
                            onClick={onSkipBackward}
                            className="p-3 rounded-full bg-surface hover:bg-white/10 text-white transition-colors"
                            title="-10s"
                        >
                            <Backward10Icon className="w-6 h-6" />
                        </button>

                        <button
                            onClick={onTogglePlayback}
                            className="p-4 rounded-full bg-primary hover:bg-primary/80 text-white transition-colors shadow-lg"
                            title={isPlayingAudio ? "Pause" : "Play"}
                        >
                            {isPlayingAudio ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
                        </button>

                        <button
                            onClick={onSkipForward}
                            className="p-3 rounded-full bg-surface hover:bg-white/10 text-white transition-colors"
                            title="+10s"
                        >
                            <Forward10Icon className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-3 text-sm text-text-secondary">
                        <span className="w-12 text-right">{formatTime(currentTime)}</span>
                        <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0}%` }}
                            />
                        </div>
                        <span className="w-12">{formatTime(audioDuration)}</span>
                    </div>

                    {/* Hidden audio element */}
                    <audio
                        ref={audioRef}
                        onTimeUpdate={onTimeUpdate}
                        onLoadedMetadata={onLoadedMetadata}
                        onEnded={onAudioEnded}
                        onError={onAudioError}
                        src={recordedAudioUrl || undefined}
                    />

                    {/* Action Buttons Group */}
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                        <button
                            onClick={onReprocessMeeting}
                            disabled={isAnalyzing}
                            className="px-3 py-2 text-xs bg-surface/50 hover:bg-surface rounded-lg text-text-secondary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                            title="Reprocess audio to improve transcription (takes time)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Reprocess Audio
                        </button>

                        <button
                            onClick={onRecluster}
                            disabled={isReclustering || transcriptLength === 0}
                            className="px-3 py-2 text-xs bg-surface/50 hover:bg-surface rounded-lg text-text-secondary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                            title={recordedAudioUrl
                                ? "Full audio analysis: extracts embeddings on uniform grid for maximum precision"
                                : "Recluster session embeddings for higher precision"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            {isReclustering ? 'Analyzing...' : (recordedAudioUrl ? 'Diarize Audio' : 'Recluster')}
                        </button>

                        <button
                            onClick={onAnalyzeText}
                            disabled={isAnalyzing || transcriptLength === 0}
                            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
                            title="LLM Analysis of text transcription"
                        >
                            <SparklesIcon className="w-4 h-4" />
                            LLM Text Analysis
                        </button>

                        <button
                            onClick={onAnalyzeAudio}
                            disabled={isAnalyzing || !recordedAudioUrl}
                            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
                            title="Direct LLM analysis of recorded audio (requires multimodal model)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                            LLM Audio Analysis
                        </button>
                    </div>
                </div>
            )}

            {/* Waveform Visualization - Only show when recording */}
            {isRecording && (
                <div className="h-12 mb-6 flex items-center justify-center gap-1">
                    {Array.from({ length: 30 }).map((_, i) => (
                        <div
                            key={i}
                            className="w-1 bg-primary rounded-full transition-all duration-75"
                            style={{
                                height: isRecording && !isPaused
                                    ? `${Math.max(10, Math.random() * audioLevel * 100)}%`
                                    : '10%',
                                opacity: isRecording && !isPaused ? 1 : 0.3
                            }}
                        />
                    ))}
                </div>
            )}

            <div className="relative flex items-center justify-center gap-6">
                {!isRecording ? (
                    <button
                        onClick={onStartRecording}
                        disabled={isLoading}
                        className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 ${isLoading ? 'bg-gray-500 cursor-wait' : 'bg-red-500 hover:bg-red-600'}`}
                    >
                        {isLoading ? (
                            <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-white" />
                        )}
                    </button>
                ) : (
                    <>
                        <button
                            onClick={onTogglePause}
                            className="w-12 h-12 rounded-full bg-surface hover:bg-white/10 flex items-center justify-center text-white border border-white/10"
                        >
                            {isPaused ? <PlayIcon className="w-6 h-6" /> : <PauseIcon className="w-6 h-6" />}
                        </button>

                        <button
                            onClick={onStopRecording}
                            className="w-16 h-16 rounded-full bg-surface border-2 border-red-500 flex items-center justify-center text-white hover:bg-red-500/10"
                        >
                            <div className="w-6 h-6 rounded bg-red-500" />
                        </button>
                    </>
                )}

                <div className="absolute right-6 top-1/2 -translate-y-1/2">
                    <button
                        onClick={onExport}
                        className="p-3 rounded-full bg-surface hover:bg-white/10 text-text-secondary hover:text-white transition-colors shadow-sm"
                        title="Export Transcription"
                    >
                        <SaveIcon className="w-6 h-6" />
                    </button>
                </div>
            </div>
        </footer>
    );
};

export default MeetingControls;
