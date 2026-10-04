import React, { useState } from 'react';
import { CloseIcon, SaveIcon } from '../../constants';
import { EMPTY_NOTES, MeetingNotes, TranscriptSegment } from '../../types/meeting';
import { exportMeetingAs } from '../../services/meeting/meetingExportService';
import { meetingExportPlugin } from '../../services/meeting/meetingExportPlugin';
import { prepareMeetingAudioExport } from '../../services/meeting/meetingStorage';
import { logger } from '../../services/logger';
import { showAlert } from '../../services/ui/dialogs';
import MeetingCouncilBridge from './MeetingCouncilBridge';

/** The saved meeting being exported (its real date and duration, and whether it has audio) */
export interface ExportMeetingInfo {
    id: string;
    timestamp: number;
    /** Seconds */
    duration: number;
    hasAudio?: boolean;
    audioMimeType?: string;
}

interface ExportBottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    meeting?: ExportMeetingInfo;
    /** Title, AI notes and marked moments (exported before the transcript in Markdown and PDF) */
    notes?: MeetingNotes;
    /** Format selected when the sheet opens (e.g. 'audio' from the history's audio button) */
    initialFormat?: string;
    onExportComplete?: (filePath: string) => void;
}

const ExportBottomSheet: React.FC<ExportBottomSheetProps> = ({
    isOpen,
    onClose,
    transcript,
    speakerNames,
    meeting,
    notes = EMPTY_NOTES,
    initialFormat,
    onExportComplete
}) => {
    const [format, setFormat] = useState<string>(initialFormat ?? (transcript.length === 0 && meeting?.hasAudio ? 'audio' : 'markdown'));
    const [includeTimestamps, setIncludeTimestamps] = useState(true);
    const [includeSpeakers, setIncludeSpeakers] = useState(true);
    const [includeNotes, setIncludeNotes] = useState(true);
    const hasNotes = !!notes.analysis || notes.bookmarks.length > 0;
    const [isExporting, setIsExporting] = useState(false);
    const [isBridgeScreen, setIsBridgeScreen] = useState(false);

    if (!isOpen) return null;

    const handleExport = async () => {
        if (format !== 'audio' && transcript.length === 0 && !hasNotes) {
            await showAlert({ title: 'No transcript to export' });
            return;
        }
        setIsExporting(true);
        try {
            if (format === 'audio' && meeting) {
                const audio = await prepareMeetingAudioExport(meeting.id, meeting.audioMimeType);
                await meetingExportPlugin.shareFile(audio.filePath, audio.mimeType, 'Share Meeting Audio');
                if (onExportComplete) onExportComplete(audio.filePath);
                onClose();
                return;
            }

            // The real meeting: a placeholder made exports carry the export time and no duration
            const exportedMeeting = {
                id: meeting?.id ?? Date.now().toString(),
                timestamp: meeting?.timestamp || Date.now(),
                transcript,
                speakerNames,
                duration: meeting?.duration ?? 0,
                hasAudio: !!meeting?.hasAudio,
                ...notes
            };

            const options = {
                includeSpeakerLabels: includeSpeakers,
                includeTimestamps: includeTimestamps,
                includeNotes,
            };

            if (format === 'pdf') {
                const { content } = await exportMeetingAs(exportedMeeting, 'pdf', options);
                await meetingExportPlugin.exportToPDF(content, `Meeting_Export_${exportedMeeting.id}`);
                onClose();
            } else {
                const { content, extension, mimeType } = await exportMeetingAs(exportedMeeting, format as any, options);
                const filename = `meeting_${exportedMeeting.id}.${extension}`;
                const filePath = await meetingExportPlugin.saveTextFile(content, filename);

                await meetingExportPlugin.shareFile(filePath, mimeType, 'Share Meeting Export');

                if (onExportComplete) onExportComplete(filePath);
                onClose();
            }
        } catch (error) {
            logger.log('error', 'Export failed', error);
            await showAlert({ title: 'Export failed', message: error instanceof Error ? error.message : String(error) });
        } finally {
            setIsExporting(false);
        }
    };

    const formats: { id: string; label: string; desc: string }[] = [
        { id: 'markdown', label: 'Markdown (.md)', desc: 'Best for notes and documentation' },
        { id: 'pdf', label: 'PDF Document (.pdf)', desc: 'Professional printable report' },
        { id: 'srt', label: 'Subtitles (.srt)', desc: 'Standard video subtitle format' },
        { id: 'vtt', label: 'Web Video Subtitles (.vtt)', desc: 'For web video players' },
        ...(meeting?.hasAudio ? [{ id: 'audio', label: 'Audio Recording', desc: 'The original meeting audio' }] : []),
    ];

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up sm:animate-fade-in"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-surface-hover">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/20 rounded-lg">
                            <SaveIcon className="w-5 h-5 text-primary" />
                        </div>
                        <h3 className="text-lg font-bold text-white">
                            {isBridgeScreen ? 'AI Council Bridge' : 'Export Meeting'}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-text-secondary hover:text-white transition-colors hover:bg-white/10 rounded-full"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                {isBridgeScreen && (
                    <MeetingCouncilBridge
                        transcript={transcript}
                        speakerNames={speakerNames}
                        analysis={notes.analysis}
                        onBack={() => setIsBridgeScreen(false)}
                        onDone={() => { setIsBridgeScreen(false); onClose(); }}
                    />
                )}

                {/* Body */}
                {!isBridgeScreen && <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6">
                    {!isBridgeScreen ? (
                        <>
                            {/* Format Selection */}
                            <div>
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
                                    File Format
                                </label>
                                <div className="grid grid-cols-1 gap-2">
                                    {formats.map(f => (
                                        <button
                                            key={f.id}
                                            onClick={() => setFormat(f.id)}
                                            className={`flex flex-col p-3 rounded-xl border transition-all text-left ${format === f.id
                                                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                                                }`}
                                        >
                                            <span className={`font-semibold ${format === f.id ? 'text-primary' : 'text-white'}`}>
                                                {f.label}
                                            </span>
                                            <span className="text-xs text-text-secondary">{f.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Options */}
                            <div className="space-y-4 pt-2">
                                <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider">
                                    Options
                                </label>
                                <div className="flex flex-col gap-3">
                                    <label className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Include Timestamps</span>
                                            <span className="text-xs text-text-secondary">Show [00:00:00] before each segment</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={includeTimestamps}
                                            onChange={e => setIncludeTimestamps(e.target.checked)}
                                            className="w-5 h-5 accent-primary bg-surface border-white/20 rounded"
                                        />
                                    </label>

                                    {hasNotes && (format === 'markdown' || format === 'pdf') && (
                                        <label className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-white">Include AI notes and marked moments</span>
                                                <span className="text-xs text-text-secondary">Before the transcript</span>
                                            </div>
                                            <input
                                                type="checkbox"
                                                checked={includeNotes}
                                                onChange={e => setIncludeNotes(e.target.checked)}
                                                className="w-5 h-5 accent-primary bg-surface border-white/20 rounded"
                                            />
                                        </label>
                                    )}

                                    <label className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-white">Include Speaker Labels</span>
                                            <span className="text-xs text-text-secondary">Show speaker names for each segment</span>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={includeSpeakers}
                                            onChange={e => setIncludeSpeakers(e.target.checked)}
                                            className="w-5 h-5 accent-primary bg-surface border-white/20 rounded"
                                        />
                                    </label>
                                </div>
                            </div>

                            {/* Bridge Shortcut */}
                            <div className="pt-2">
                                <button
                                    onClick={() => setIsBridgeScreen(true)}
                                    className="w-full p-4 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all text-left flex items-center justify-between"
                                >
                                    <div>
                                        <span className="font-bold text-primary block">Propose to AI Council</span>
                                        <span className="text-xs text-text-secondary">Analyze transcript for goals/ideas and submit to Org Layer</span>
                                    </div>
                                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>
                        </>
                    ) : null}
                </div>}

                {/* Footer */}
                {!isBridgeScreen && <div className="p-6 pt-2 border-t border-white/10 bg-surface-hover">
                    {!isBridgeScreen ? (
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 shadow-lg transition-all ${isExporting
                                ? 'bg-white/10 text-text-secondary cursor-not-allowed'
                                : 'bg-primary text-white hover:brightness-110 active:scale-[0.98]'
                                }`}
                        >
                            {isExporting ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    <span>Exporting...</span>
                                </>
                            ) : (
                                <>
                                    <SaveIcon className="w-5 h-5" />
                                    <span>Export & Share</span>
                                </>
                            )}
                        </button>
                    ) : null}
                </div>}
            </div>
        </div>
    );
};

export default ExportBottomSheet;
