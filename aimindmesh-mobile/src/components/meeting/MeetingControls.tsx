import React from 'react';
import {
    PauseIcon,
    PlayIcon,
    SaveIcon,
    Forward10Icon,
    Backward10Icon,
    FlagIcon
} from '../../constants';
import { AudioPlaybackState } from '../../hooks/meeting/useAudioPlayback';
import LevelMeter from './LevelMeter';

interface MeetingControlsProps {
    // Recording state
    isRecording: boolean;
    isPaused: boolean;
    subscribeLevel: (listener: (level: number) => void) => () => void;
    /** While recording: how far the accurate (Whisper) transcript has got, or null if not running. */
    liveTranscribedMs?: number | null;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onTogglePause: () => void;
    /** Marks the current moment (of the recording, or of the playback). */
    onMarkMoment: () => void;
    bookmarkCount: number;
    /** The meeting player, whose <audio> element is rendered here. */
    playback: AudioPlaybackState;
    // Actions
    transcriptLength: number;
    isPostProcessing: boolean;
    onTranscribe: () => void;
    onIdentifySpeakers: () => void;
    onExport: () => void;
    onImportAudio?: () => void;
    isLoading?: boolean;
}

const MeetingControls: React.FC<MeetingControlsProps> = ({
    isRecording,
    isPaused,
    subscribeLevel,
    liveTranscribedMs = null,
    onStartRecording,
    onStopRecording,
    onTogglePause,
    onMarkMoment,
    bookmarkCount,
    onImportAudio,
    playback,
    transcriptLength,
    isPostProcessing,
    onTranscribe,
    onIdentifySpeakers,
    onExport,
    isLoading = false
}) => {
    const {
        recordedAudioUrl, isPlayingAudio, currentTime, audioDuration, playbackRate, formatTime, audioRef,
        togglePlayback: onTogglePlayback, skipForward: onSkipForward, skipBackward: onSkipBackward,
        cyclePlaybackRate: onCyclePlaybackRate
    } = playback;
    const hasMeeting = !!recordedAudioUrl || transcriptLength > 0;

    return (
        <footer className="px-4 pt-3 pb-4 border-t border-surface bg-surface/20 backdrop-blur-md">
            {/* Hidden audio element: the meeting player */}
            <audio
                ref={audioRef}
                onTimeUpdate={playback.handleTimeUpdate}
                onLoadedMetadata={playback.handleLoadedMetadata}
                onEnded={playback.handleAudioEnded}
                onError={playback.handleAudioError}
                src={recordedAudioUrl || undefined}
                preload="metadata"
            />

            {!isRecording && recordedAudioUrl && (
                <div className="mb-3">
                    {/* Seek bar */}
                    <div className="flex items-center gap-3 text-xs text-text-secondary font-mono">
                        <span className="w-12 text-right">{formatTime(currentTime)}</span>
                        <input
                            type="range"
                            min={0}
                            max={audioDuration > 0 ? audioDuration : 0}
                            step={0.1}
                            value={Math.min(currentTime, audioDuration || 0)}
                            onChange={e => playback.seekTo(Number(e.target.value))}
                            disabled={audioDuration <= 0}
                            className="flex-1 accent-primary h-1"
                            aria-label={'Position in the recording'}
                        />
                        <span className="w-12">{formatTime(audioDuration)}</span>
                    </div>

                    <div className="flex items-center justify-center gap-3 mt-2">
                        <button
                            onClick={onCyclePlaybackRate}
                            className="w-12 py-1.5 rounded-full bg-surface hover:bg-white/10 text-white text-xs font-semibold"
                            title={'Playback speed'}
                        >
                            {playbackRate}×
                        </button>
                        <button
                            onClick={onSkipBackward}
                            className="p-2.5 rounded-full bg-surface hover:bg-white/10 text-white transition-colors"
                            title={'Back 10 s'}
                        >
                            <Backward10Icon className="w-5 h-5" />
                        </button>
                        <button
                            onClick={onTogglePlayback}
                            className="p-3.5 rounded-full bg-primary hover:bg-primary/80 text-white transition-colors shadow-lg"
                            title={isPlayingAudio ? 'Pause' : 'Play'}
                        >
                            {isPlayingAudio ? <PauseIcon className="w-7 h-7" /> : <PlayIcon className="w-7 h-7" />}
                        </button>
                        <button
                            onClick={onSkipForward}
                            className="p-2.5 rounded-full bg-surface hover:bg-white/10 text-white transition-colors"
                            title={'Forward 10 s'}
                        >
                            <Forward10Icon className="w-5 h-5" />
                        </button>
                        <button
                            onClick={onMarkMoment}
                            className="w-12 py-1.5 rounded-full bg-surface hover:bg-white/10 text-amber-300 flex justify-center"
                            title={'Mark this moment'}
                            aria-label={'Mark this moment'}
                        >
                            <FlagIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {!isRecording && hasMeeting && (
                <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                    <button
                        onClick={onTranscribe}
                        disabled={isPostProcessing || !recordedAudioUrl}
                        className="px-3 py-2 text-xs bg-surface/50 hover:bg-surface rounded-lg text-text-secondary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                        title={'Transcribe the whole recording with Whisper on the phone (replaces the live transcript)'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Transcribe (Whisper)
                    </button>

                    <button
                        onClick={onIdentifySpeakers}
                        disabled={isPostProcessing || transcriptLength === 0 || !recordedAudioUrl}
                        className="px-3 py-2 text-xs bg-surface/50 hover:bg-surface rounded-lg text-text-secondary hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                        title={'Identify who speaks in each sentence from the recording\'s voices'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        {isPostProcessing ? 'Processing...' : 'Identify speakers'}
                    </button>
                </div>
            )}

            {/* Waveform Visualization - Only show when recording */}
            {isRecording && <LevelMeter subscribe={subscribeLevel} isPaused={isPaused} />}
            {isRecording && liveTranscribedMs !== null && (
                <p className="-mt-2 mb-3 text-center text-[11px] text-purple-200/70">
                    {liveTranscribedMs > 0
                        ? `Accurate transcript ready up to ${playback.formatTime(liveTranscribedMs / 1000)}`
                        : 'Accurate transcript: starting…'}
                </p>
            )}

            <div className="relative flex items-center justify-center gap-6">
                {!isRecording ? (
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onStartRecording}
                            disabled={isLoading}
                            className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 ${isLoading ? 'bg-gray-500 cursor-wait' : 'bg-red-500 hover:bg-red-600'}`}
                            title={'Start Recording'}
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

                        {onImportAudio && (
                            <button
                                onClick={onImportAudio}
                                disabled={isLoading}
                                className="w-12 h-12 rounded-full bg-surface hover:bg-white/10 flex items-center justify-center text-text-secondary hover:text-white border border-white/10 transition-colors shadow-md"
                                title={'Import Audio File'}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <button
                            onClick={onTogglePause}
                            className="w-12 h-12 rounded-full bg-surface hover:bg-white/10 flex items-center justify-center text-white border border-white/10"
                            title={isPaused ? 'Resume' : 'Pause'}
                        >
                            {isPaused ? <PlayIcon className="w-6 h-6" /> : <PauseIcon className="w-6 h-6" />}
                        </button>

                        <button
                            onClick={onStopRecording}
                            className="w-16 h-16 rounded-full bg-surface border-2 border-red-500 flex items-center justify-center text-white hover:bg-red-500/10"
                            title={'Stop'}
                        >
                            <div className="w-6 h-6 rounded bg-red-500" />
                        </button>

                        <button
                            onClick={onMarkMoment}
                            className="relative w-12 h-12 rounded-full bg-amber-400/15 hover:bg-amber-400/25 flex items-center justify-center text-amber-300 border border-amber-400/30"
                            title={'Mark this moment as important'}
                            aria-label={'Mark this moment as important'}
                        >
                            <FlagIcon className="w-6 h-6" />
                            {bookmarkCount > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-black text-[10px] font-bold flex items-center justify-center">
                                    {bookmarkCount}
                                </span>
                            )}
                        </button>
                    </>
                )}

                {!isRecording && (
                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
                        <button
                            onClick={onExport}
                            className="p-3 rounded-full bg-surface hover:bg-white/10 text-text-secondary hover:text-white transition-colors shadow-sm"
                            title={'Export or share'}
                        >
                            <SaveIcon className="w-6 h-6" />
                        </button>
                    </div>
                )}
            </div>
        </footer>
    );
};

export default MeetingControls;
