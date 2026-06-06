import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, PlayIcon, PauseIcon, SaveIcon } from '../../constants';
import { logger } from '../../services/logger';

import { Capacitor } from '@capacitor/core';
import { deleteMeeting as deleteMeetingFromStorage, loadMeetingsAsync, getMeetingAudioFile } from '../../services/meeting/meetingStorage';
import { SavedMeeting } from '../../types/meeting';
import ExportBottomSheet from './ExportBottomSheet';

interface MeetingHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    onReprocess?: (meeting: SavedMeeting) => void;
}

const MeetingHistory: React.FC<MeetingHistoryProps> = ({ isOpen, onClose, onReprocess }) => {
    const [meetings, setMeetings] = useState<SavedMeeting[]>([]);
    const [selectedMeeting, setSelectedMeeting] = useState<SavedMeeting | null>(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isExportSheetOpen, setIsExportSheetOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadMeetingsData();
        }
    }, [isOpen]);

    // Load meeting audio and create URL when meeting is selected
    useEffect(() => {
        const loadAudio = async () => {
            if (selectedMeeting?.hasAudio) {
                // Check if we already have the data (rare, mostly for backward compatibility)
                if (selectedMeeting.audioData) {
                    createAudioUrl(selectedMeeting.audioData, selectedMeeting.audioMimeType || 'audio/webm');
                    return;
                }

                setIsLoadingAudio(true);
                try {
                    const audioFile = await getMeetingAudioFile(selectedMeeting.id);
                    if (audioFile) {
                        const localUrl = Capacitor.convertFileSrc(audioFile.path);
                        setAudioUrl(localUrl);
                    } else {
                        logger.log('warn', `Audio file not found for meeting ${selectedMeeting.id}`);
                        setAudioUrl(null);
                    }
                } catch (error) {
                    logger.log('error', 'Failed to load meeting audio URL', error);
                    setAudioUrl(null);
                } finally {
                    setIsLoadingAudio(false);
                }
            } else {
                setAudioUrl(null);
                setIsLoadingAudio(false);
            }
        };

        if (selectedMeeting) {
            setAudioUrl(null);
            setCurrentTime(0);
            setIsPlayingAudio(false);
            loadAudio();
        }

        return () => {
            setAudioUrl(null);
        };
    }, [selectedMeeting?.id]); // Only reload if ID changes

    const createAudioUrl = (base64Data: string, mimeType: string) => {
        try {
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
        } catch (e) {
            logger.log('error', 'Failed to create audio URL', e);
        }
    };

    const loadMeetingsData = async () => {
        try {
            const savedMeetings = await loadMeetingsAsync();
            setMeetings(savedMeetings);
            logger.log('info', `Loaded ${savedMeetings.length} meetings`);
        } catch (error) {
            logger.log('error', 'Failed to load meetings', error);
        }
    };

    const deleteMeeting = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this meeting? This cannot be undone.')) return;

        try {
            const success = await deleteMeetingFromStorage(id);
            if (success) {
                const updatedMeetings = meetings.filter(m => m.id !== id);
                setMeetings(updatedMeetings);
                if (selectedMeeting?.id === id) {
                    setSelectedMeeting(null);
                }
                logger.log('info', `Deleted meeting ${id}`);
            }
        } catch (error) {
            logger.log('error', 'Failed to delete meeting', error);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDuration = (seconds: number) => {
        if (!isFinite(seconds) || isNaN(seconds) || seconds === 0) {
            return 'N/A';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const togglePlayback = () => {
        if (!audioRef.current || !audioUrl) return;

        if (isPlayingAudio) {
            audioRef.current.pause();
            setIsPlayingAudio(false);
        } else {
            audioRef.current.play().catch(e => logger.log('error', 'Audio playback failed', e));
            setIsPlayingAudio(true);
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleAudioEnded = () => {
        setIsPlayingAudio(false);
        setCurrentTime(0);
    };

    const exportAudio = async () => {
        if (!selectedMeeting) return;
        setIsExportSheetOpen(true);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-white/10 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Meeting History</h2>
                    <button
                        onClick={onClose}
                        className="text-text-secondary hover:text-white transition-colors"
                    >
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Hidden audio element */}
                {audioUrl && (
                    <audio
                        ref={audioRef}
                        src={audioUrl}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={handleAudioEnded}
                    />
                )}

                {/* Content */}
                <div className="flex-1 overflow-hidden flex">
                    {/* Meeting List */}
                    <div className="w-1/3 border-r border-white/10 overflow-y-auto">
                        {meetings.length === 0 ? (
                            <div className="p-8 text-center text-text-secondary">
                                <p>No saved meetings</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-white/10">
                                {meetings.map((meeting) => (
                                    <div
                                        key={meeting.id}
                                        onClick={() => setSelectedMeeting(meeting)}
                                        className={`p-4 cursor-pointer transition-colors hover:bg-white/5 ${selectedMeeting?.id === meeting.id ? 'bg-primary/20' : ''
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-white">
                                                    {formatDate(meeting.timestamp)}
                                                </p>
                                                <p className="text-xs text-text-secondary mt-1">
                                                    {meeting.transcript.length > 0
                                                        ? `${meeting.transcript.length} segments`
                                                        : 'Audio only'} • {formatDuration(meeting.duration)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteMeeting(meeting.id);
                                                }}
                                                className="text-text-secondary hover:text-red-400 transition-colors ml-2"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                        {meeting.hasAudio && (
                                            <span className="text-xs text-primary">● Audio available</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Meeting Detail */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {selectedMeeting ? (
                            <div>
                                <div className="mb-6">
                                    <h3 className="text-lg font-bold text-white mb-2">
                                        Meeting of {formatDate(selectedMeeting.timestamp)}
                                    </h3>
                                    <div className="flex gap-4 text-sm text-text-secondary">
                                        <span>
                                            {selectedMeeting.transcript.length > 0
                                                ? `${selectedMeeting.transcript.length} segments`
                                                : 'Audio only (transcript not done)'}
                                        </span>
                                        <span>Duration: {formatDuration(selectedMeeting.duration)}</span>
                                        {selectedMeeting.transcript.length > 0 && (
                                            <span>
                                                {Object.keys(selectedMeeting.speakerNames).length ||
                                                    new Set(selectedMeeting.transcript.map(t => t.speakerId)).size} speakers
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Audio Player (if audio available) */}
                                {selectedMeeting.hasAudio && (
                                    <div className="mb-6 p-4 bg-surface-hover rounded-lg border border-white/10">
                                        {isLoadingAudio ? (
                                            <div className="flex items-center justify-center gap-3 py-2">
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                                                <span className="text-sm text-text-secondary">Loading audio...</span>
                                            </div>
                                        ) : audioUrl ? (
                                            <div className="flex items-center gap-4">
                                                <button
                                                    onClick={togglePlayback}
                                                    className="p-3 bg-primary rounded-full text-white hover:bg-primary-dark transition-colors"
                                                >
                                                    {isPlayingAudio ? (
                                                        <PauseIcon className="w-5 h-5" />
                                                    ) : (
                                                        <PlayIcon className="w-5 h-5" />
                                                    )}
                                                </button>
                                                <div className="flex-1">
                                                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-primary transition-all"
                                                            style={{ width: selectedMeeting.duration > 0 ? `${(currentTime / selectedMeeting.duration) * 100}%` : '0%' }}
                                                        />
                                                    </div>
                                                    <div className="flex justify-between text-xs text-text-secondary mt-1">
                                                        <span>{formatDuration(currentTime)}</span>
                                                        <span>{formatDuration(selectedMeeting.duration)}</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={exportAudio}
                                                    className="p-2 text-text-secondary hover:text-primary transition-colors"
                                                    title="Export audio"
                                                >
                                                    <SaveIcon className="w-5 h-5" />
                                                </button>
                                                {onReprocess && (
                                                    <button
                                                        onClick={() => onReprocess(selectedMeeting)}
                                                        className="p-2 text-text-secondary hover:text-primary transition-colors"
                                                        title="Reprocess audio"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-center py-2 text-sm text-red-400">
                                                Audio file not found or corrupted.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Transcript or Audio-only message */}
                                <div className="space-y-4">
                                    <h4 className="font-semibold text-white">Transcript</h4>
                                    {selectedMeeting.transcript.length > 0 ? (
                                        selectedMeeting.transcript.map((segment) => {
                                            const speakerName = selectedMeeting.speakerNames[segment.speakerId] ||
                                                `Speaker ${segment.speakerId + 1}`;
                                            return (
                                                <div key={segment.id} className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                                            {speakerName}
                                                        </span>
                                                        <span className="text-xs text-text-secondary">
                                                            {new Date(segment.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    <p className="text-white pl-2 border-l-2 border-surface">
                                                        {segment.text}
                                                    </p>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-600/30 text-center">
                                            <p className="text-gray-400 text-sm">
                                                This meeting was recorded in battery saver mode.
                                            </p>
                                            <p className="text-gray-500 text-xs mt-2">
                                                Transcript is unavailable. You can export the audio to reprocess it.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-text-secondary">
                                <p>Select a meeting to view details</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {selectedMeeting && (
                <ExportBottomSheet
                    isOpen={isExportSheetOpen}
                    onClose={() => setIsExportSheetOpen(false)}
                    transcript={selectedMeeting.transcript || []}
                    speakerNames={selectedMeeting.speakerNames || {}}
                />
            )}
        </div>
    );
};

export default MeetingHistory;
