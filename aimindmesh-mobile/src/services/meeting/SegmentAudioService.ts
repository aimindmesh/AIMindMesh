import { registerPlugin } from '@capacitor/core';
import { logger } from '../logger';

export interface AudioPlaybackPlugin {
    playSegment(options: { filePath: string; startMs: number; endMs: number; speed?: number }): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    setSpeed(options: { speed: number }): Promise<void>;
    addListener(eventName: 'playbackProgress', listenerFunc: (info: { currentPosition: number, duration: number, startMs: number, endMs: number }) => void): Promise<any>;
    addListener(eventName: 'playbackStateChanged', listenerFunc: (info: { state: 'playing' | 'paused' | 'stopped' | 'completed' | 'error', error?: string }) => void): Promise<any>;
}

const AudioPlayback = registerPlugin<AudioPlaybackPlugin>('AudioPlayback');

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'error';

class SegmentAudioService {
    private static instance: SegmentAudioService;
    private currentState: PlaybackState = 'idle';
    private currentSegmentId: string | null = null;

    private stateListeners: Set<(state: PlaybackState, segmentId: string | null) => void> = new Set();
    private progressListeners: Set<(progress: number, currentPositionMs: number) => void> = new Set();


    private constructor() {
        this.initializeListeners();
    }

    public static getInstance(): SegmentAudioService {
        if (!SegmentAudioService.instance) {
            SegmentAudioService.instance = new SegmentAudioService();
        }
        return SegmentAudioService.instance;
    }

    private async initializeListeners() {
        try {
            await AudioPlayback.addListener('playbackProgress', (info) => {
                const relativePos = info.currentPosition - info.startMs;
                const totalDuration = info.endMs - info.startMs;
                const progress = totalDuration > 0 ? relativePos / totalDuration : 0;

                this.notifyProgressListeners(progress, info.currentPosition);
            });

            await AudioPlayback.addListener('playbackStateChanged', (info) => {
                let newState: PlaybackState;
                switch (info.state) {
                    case 'playing': newState = 'playing'; break;
                    case 'paused': newState = 'paused'; break;
                    case 'error': newState = 'error'; break;
                    case 'stopped':
                    case 'completed':
                    default:
                        newState = 'idle';
                        if (info.state === 'completed' || info.state === 'stopped') {
                            this.currentSegmentId = null; // Clear active segment
                        }
                        break;
                }

                if (info.error) {
                    logger.log('error', `AudioPlayback error: ${info.error}`);
                }

                this.setState(newState);
            });
            logger.log('info', 'SegmentAudioService listeners initialized');
        } catch (error) {
            logger.log('warn', 'AudioPlayback plugin might not be available or running on web', error);
        }
    }

    public async playSegment(segmentId: string, filePath: string, startMs: number, endMs: number, speed: number = 1.0) {
        try {
            this.currentSegmentId = segmentId;
            this.setState('playing'); // Optimistic

            await AudioPlayback.playSegment({
                filePath,
                startMs,
                endMs,
                speed
            });
        } catch (error) {
            logger.log('error', `Failed to play segment ${segmentId}`, error);
            this.setState('error');
            this.currentSegmentId = null;
            throw error;
        }
    }

    public async pause() {
        try {
            await AudioPlayback.pause();
        } catch (error) {
            logger.log('error', 'Failed to pause playback', error);
        }
    }

    public async resume() {
        try {
            await AudioPlayback.resume();
        } catch (error) {
            logger.log('error', 'Failed to resume playback', error);
        }
    }

    public async stop() {
        try {
            await AudioPlayback.stop();
            this.currentSegmentId = null;
            this.setState('idle');
        } catch (error) {
            logger.log('error', 'Failed to stop playback', error);
        }
    }

    public async setSpeed(speed: number) {
        try {
            await AudioPlayback.setSpeed({ speed });
        } catch (error) {
            logger.log('error', 'Failed to change playback speed', error);
        }
    }

    public getState(): { state: PlaybackState, activeSegmentId: string | null } {
        return {
            state: this.currentState,
            activeSegmentId: this.currentSegmentId
        };
    }

    public subscribe(listener: (state: PlaybackState, segmentId: string | null) => void) {
        this.stateListeners.add(listener);
        return () => { this.stateListeners.delete(listener); };
    }

    public subscribeToProgress(listener: (progress: number, currentPositionMs: number) => void) {
        this.progressListeners.add(listener);
        return () => { this.progressListeners.delete(listener); };
    }

    private setState(newState: PlaybackState) {
        if (this.currentState !== newState) {
            this.currentState = newState;
            this.notifyStateListeners();
        }
    }

    private notifyStateListeners() {
        this.stateListeners.forEach(l => l(this.currentState, this.currentSegmentId));
    }

    private notifyProgressListeners(progress: number, currentPositionMs: number) {
        this.progressListeners.forEach(l => l(progress, currentPositionMs));
    }
}

export const segmentAudioService = SegmentAudioService.getInstance();
