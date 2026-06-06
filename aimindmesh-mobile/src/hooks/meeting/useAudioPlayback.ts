import { useState, useRef } from 'react';

export interface AudioPlaybackState {
    isPlayingAudio: boolean;
    audioDuration: number;
    currentTime: number;
    recordedAudioUrl: string | null;
    audioRef: React.RefObject<HTMLAudioElement>;
    setRecordedAudioUrl: (url: string | null) => void;
    setAudioDuration: (duration: number) => void;
    togglePlayback: () => void;
    skipForward: () => void;
    skipBackward: () => void;
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
 * Hook for managing audio playback controls
 */
export function useAudioPlayback({ showToast }: UseAudioPlaybackOptions): AudioPlaybackState {
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const [audioDuration, setAudioDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

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
            audioRef.current.play().catch(error => {
                console.error('Audio playback failed', error);
                showToast('Audio playback error', 'error');
            });
            setIsPlayingAudio(true);
        }
    };

    const skipForward = () => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 10, audioDuration);
    };

    const skipBackward = () => {
        if (!audioRef.current) return;
        audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 10, 0);
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
        if (audioRef.current && isFinite(audioRef.current.duration)) {
            setAudioDuration(audioRef.current.duration);
        }
    };

    const handleAudioEnded = () => {
        setIsPlayingAudio(false);
        setCurrentTime(0);
    };

    const handleAudioError = (e: any) => {
        console.error('Audio element error', e.target?.error);
        showToast('Error loading audio', 'error');
        setIsPlayingAudio(false);
    };

    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || isNaN(seconds)) {
            return '0:00';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return {
        isPlayingAudio,
        audioDuration,
        currentTime,
        recordedAudioUrl,
        audioRef: audioRef as React.RefObject<HTMLAudioElement>,
        setRecordedAudioUrl,
        setAudioDuration,
        togglePlayback,
        skipForward,
        skipBackward,
        handleTimeUpdate,
        handleLoadedMetadata,
        handleAudioEnded,
        handleAudioError,
        formatTime
    };
}
