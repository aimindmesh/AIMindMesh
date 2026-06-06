import React, { useState } from 'react';
import { TranscriptSegment } from '../../types/meeting';
import { MicrophoneIcon, PlayIcon, PauseIcon } from '../../constants';

interface MeetingTranscriptProps {
    transcript: TranscriptSegment[];
    currentText: string;
    speakerNames: Record<number, string>;
    onRenameSpeaker: (speakerId: number) => void;
    transcriptEndRef: React.RefObject<HTMLDivElement>;
    showAnalysis: boolean;
    isProcessing?: boolean;
    processingStatus?: string;
    onSegmentPlay?: (segment: TranscriptSegment) => void;
    onSegmentEdit?: (segment: TranscriptSegment, newText: string) => void;
    activeSegmentId?: string | null;
    isPlaying?: boolean;
}

const MeetingTranscript: React.FC<MeetingTranscriptProps> = ({
    transcript,
    currentText,
    speakerNames,
    onRenameSpeaker,
    transcriptEndRef,
    showAnalysis,
    isProcessing,
    processingStatus,
    onSegmentPlay,
    onSegmentEdit,
    activeSegmentId,
    isPlaying
}) => {
    const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');

    const handleEditStart = (segment: TranscriptSegment) => {
        setEditingSegmentId(segment.id);
        setEditText(segment.text);
    };

    const handleEditSave = (segment: TranscriptSegment) => {
        if (onSegmentEdit && editText.trim() !== segment.text) {
            onSegmentEdit(segment, editText.trim());
        }
        setEditingSegmentId(null);
    };

    const handleEditCancel = () => {
        setEditingSegmentId(null);
    };
    return (
        <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${showAnalysis ? 'hidden md:block' : ''}`}>
            {transcript.length === 0 && !currentText && (
                <div className="h-full flex flex-col items-center justify-center text-text-secondary opacity-50">
                    <MicrophoneIcon className="w-16 h-16 mb-4" />
                    <p>Press Record to start the meeting</p>
                </div>
            )}

            {transcript.map((segment) => {
                const isActive = activeSegmentId === segment.id;
                const isEditing = editingSegmentId === segment.id;

                return (
                    <div
                        key={segment.id}
                        className={`flex flex-col gap-1 p-2 rounded-lg transition-colors ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover:bg-white/5'
                            } animate-fade-in-up group`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRenameSpeaker(segment.speakerId);
                                    }}
                                    className="text-xs font-bold text-primary cursor-pointer hover:underline bg-primary/10 px-2 py-0.5 rounded-full"
                                >
                                    {speakerNames[segment.speakerId] || `Speaker ${segment.speakerId + 1}`}
                                </span>
                                <span className="text-xs text-text-secondary">
                                    {new Date(segment.timestamp).toLocaleTimeString()}
                                    {segment.isEdited && ' (edited)'}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onSegmentPlay && segment.start_ms !== undefined && (
                                    <button
                                        onClick={() => onSegmentPlay(segment)}
                                        className={`p-1.5 rounded-full transition-colors ${isActive && isPlaying
                                            ? 'bg-primary text-white'
                                            : 'bg-surface-hover text-text-secondary hover:text-primary'
                                            }`}
                                        title={isActive && isPlaying ? "Pause audio" : "Play original audio"}
                                    >
                                        {isActive && isPlaying ? (
                                            <PauseIcon className="w-4 h-4" />
                                        ) : (
                                            <PlayIcon className="w-4 h-4" />
                                        )}
                                    </button>
                                )}
                                {onSegmentEdit && !isEditing && (
                                    <button
                                        onClick={() => handleEditStart(segment)}
                                        className="p-1.5 bg-surface-hover text-text-secondary rounded-full hover:text-white transition-colors"
                                        title="Edit text"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Text Content */}
                        {isEditing ? (
                            <div className="mt-2 flex flex-col gap-2">
                                <textarea
                                    className="w-full bg-surface-hover text-white border border-white/20 rounded p-2 text-sm focus:outline-none focus:border-primary resize-none min-h-[60px]"
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={handleEditCancel}
                                        className="px-3 py-1.5 text-xs text-text-secondary hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => handleEditSave(segment)}
                                        className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary-dark transition-colors"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p
                                className="text-white pl-2 border-l-2 border-surface cursor-pointer"
                                onClick={() => onSegmentPlay && segment.start_ms !== undefined && onSegmentPlay(segment)}
                                title={segment.start_ms !== undefined ? "Tap to play audio" : ""}
                            >
                                {segment.text}
                            </p>
                        )}
                    </div>
                );
            })}

            {currentText && (
                <div className="flex flex-col gap-1 opacity-70">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-secondary">
                            Detecting...
                        </span>
                    </div>
                    <p className="text-white pl-2 border-l-2 border-primary/50 italic">{currentText}</p>
                </div>
            )}

            {/* Processing Status Overlay */}
            {isProcessing && (
                <div className="sticky bottom-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
                    <div className="bg-surface/90 backdrop-blur-md border border-primary/30 px-4 py-2 rounded-full shadow-lg flex items-center gap-3 animate-fade-in-up">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm font-medium text-white shadow-sm">
                            {processingStatus || 'Processing...'}
                        </span>
                    </div>
                </div>
            )}

            <div ref={transcriptEndRef} />
        </div>
    );
};

export default MeetingTranscript;
