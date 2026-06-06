import React, { useEffect, useState } from 'react';
import { PlayIcon, PauseIcon } from '../../constants';
import { segmentAudioService, PlaybackState } from '../../services/meeting/SegmentAudioService';

interface AudioMiniPlayerProps {
    className?: string;
}

const AudioMiniPlayer: React.FC<AudioMiniPlayerProps> = ({ className = '' }) => {
    const [audioState, setAudioState] = useState<PlaybackState>('idle');
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const unsubscribeState = segmentAudioService.subscribe((state) => {
            setAudioState(state);
        });
        const unsubscribeProgress = segmentAudioService.subscribeToProgress((p) => {
            setProgress(p || 0);
        });
        return () => {
            unsubscribeState();
            unsubscribeProgress();
        };
    }, []);

    if (audioState === 'idle') {
        return null;
    }

    const isPlaying = audioState === 'playing';

    const handleTogglePlay = async () => {
        if (isPlaying) {
            await segmentAudioService.pause();
        } else {
            await segmentAudioService.resume();
        }
    };

    const handleStop = async () => {
        await segmentAudioService.stop();
    };

    return (
        <div className={`flex flex-col bg-surface-hover/95 backdrop-blur shadow-lg border-t border-white/10 ${className}`}>
            {/* Progress Bar */}
            <div className="h-1 bg-white/10 w-full overflow-hidden">
                <div
                    className="h-full bg-primary transition-all duration-100 ease-linear"
                    style={{ width: `${progress * 100}%` }}
                />
            </div>

            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleTogglePlay}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-dark transition-colors shadow-sm"
                    >
                        {isPlaying ? (
                            <PauseIcon className="w-5 h-5" />
                        ) : (
                            <PlayIcon className="w-5 h-5 ml-1" />
                        )}
                    </button>
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">
                            {isPlaying ? 'Playing Segment' : 'Paused'}
                        </span>
                        <span className="text-xs text-text-secondary">
                            Original Meeting Audio
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleStop}
                        className="p-2 text-text-secondary hover:text-white transition-colors rounded-full hover:bg-white/5"
                        title="Close Player"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AudioMiniPlayer;
