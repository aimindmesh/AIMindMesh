import { useState, useRef, useCallback } from 'react';

export const PLAYBACK_RATES = [1, 1.25, 1.5, 2];

export interface AudioPlaybackState {
    isPlayingAudio: boolean;
    audioDuration: number;
    currentTime: number;
    playbackRate: number;
    recordedAudioUrl: string | null;
    audioRef: React.RefObject<HTMLAudioElement>;
    setRecordedAudioUrl: (url: string | null) => void;
    setAudioDuration: (duration: number) => void;
    togglePlayback: () => void;
    skipForward: () => void;
    skipBackward: () => void;
    /** Moves to `seconds` into the recording, and plays from there if asked. */
    seekTo: (seconds: number, play?: boolean) => void;
    cyclePlaybackRate: () => void;
    handleTimeUpdate: () => void;
    handleLoadedMetadata: () => void;
    handleAudioEnded: () => void;
    handleAudioError: (e: any) => void;
    formatTime: (seconds: number) => string;
}

interface UseAudioPlaybackOptions {
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * The meeting player: one <audio> element (rendered by MeetingControls) that the transcript
 * follows and seeks.
 */
export function useAudioPlayback({ showToast }: UseAudioPlaybackOptions): AudioPlaybackState {
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const [audioDuration, setAudioDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [recordedAudioUrl, setUrl] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    const setRecordedAudioUrl = useCallback((url: string | null) => {
        setUrl(url);
        setCurrentTime(0);
        setIsPlayingAudio(false);
    }, []);

    const play = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.playbackRate = playbackRate;
        audio.play()
            .then(() => setIsPlayingAudio(true))
            .catch(error => {
                console.error('Audio playback failed', error);
                showToast('Audio playback error', 'error');
                setIsPlayingAudio(false);
            });
    }, [playbackRate, showToast]);

    const togglePlayback = () => {
        if (!audioRef.current) {
            return;
        }

        if (!recordedAudioUrl) {
            showToast('No audio to play', 'info');
            return;
        }

        if (isPlayingAudio) {
            audioRef.current.pause();
            setIsPlayingAudio(false);
        } else {
            play();
        }
    };

    const seekTo = useCallback((seconds: number, playAfter = false) => {
        const audio = audioRef.current;
        if (!audio || !recordedAudioUrl) {
            showToast('No audio for this meeting', 'info');
            return;
        }
        const duration = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioDuration;
        const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.05) : seconds);
        audio.currentTime = target;
        setCurrentTime(target);
        if (playAfter && audio.paused) {
            play();
        }
    }, [recordedAudioUrl, audioDuration, play, showToast]);

    const skipForward = () => seekTo((audioRef.current?.currentTime ?? 0) + 10);
    const skipBackward = () => seekTo((audioRef.current?.currentTime ?? 0) - 10);

    const cyclePlaybackRate = () => {
        const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
        setPlaybackRate(next);
        if (audioRef.current) {
            audioRef.current.playbackRate = next;
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
            // Fallback: sometimes duration isn't available immediately via metadata
            if (audioDuration === 0 && audioRef.current.duration > 0 && isFinite(audioRef.current.duration)) {
                setAudioDuration(audioRef.current.duration);
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current && isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
            setAudioDuration(audioRef.current.duration);
        }
    };

    const handleAudioEnded = () => {
        setIsPlayingAudio(false);
    };

    const handleAudioError = (e: any) => {
        console.error('Audio element error', e.target?.error);
        showToast('Error loading audio', 'error');
        setIsPlayingAudio(false);
    };

    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) {
            return '0:00';
        }
        const total = Math.floor(seconds);
        const h = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        const pad = (n: number) => n.toString().padStart(2, '0');
        return h > 0 ? `${h}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
    };

    return {
        isPlayingAudio,
        audioDuration,
        currentTime,
        playbackRate,
        recordedAudioUrl,
        audioRef: audioRef as React.RefObject<HTMLAudioElement>,
        setRecordedAudioUrl,
        setAudioDuration,
        togglePlayback,
        skipForward,
        skipBackward,
        seekTo,
        cyclePlaybackRate,
        handleTimeUpdate,
        handleLoadedMetadata,
        handleAudioEnded,
        handleAudioError,
        formatTime
    };
}
