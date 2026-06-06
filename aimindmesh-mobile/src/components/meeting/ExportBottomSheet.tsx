import React, { useState } from 'react';
import { CloseIcon, SaveIcon } from '../../constants';
import { TranscriptSegment } from '../../types/meeting';
import { exportMeetingAs } from '../../services/meeting/meetingExportService';
import { meetingExportPlugin } from '../../services/meeting/meetingExportPlugin';
import { logger } from '../../services/logger';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../../types';
import { extractMeetingCandidates, MeetingActionCandidate } from '../../services/meetingOrganizationBridge';
import { organizationApi } from '../../services/organizationApi';

interface ExportBottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    onExportComplete?: (filePath: string) => void;
}

const ExportBottomSheet: React.FC<ExportBottomSheetProps> = ({
    isOpen,
    onClose,
    transcript,
    speakerNames,
    onExportComplete
}) => {
    const [aimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>(
        'aimindmesh-server-settings',
        DEFAULT_AIMINDMESH_SERVER_SETTINGS
    );

    const [format, setFormat] = useState<string>('markdown');
    const [includeTimestamps, setIncludeTimestamps] = useState(true);
    const [includeSpeakers, setIncludeSpeakers] = useState(true);
    const [isExporting, setIsExporting] = useState(false);

    // AI Bridge State
    const [isBridgeScreen, setIsBridgeScreen] = useState(false);
    const [candidates, setCandidates] = useState<MeetingActionCandidate[]>([]);
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
    const [isSubmittingBridge, setIsSubmittingBridge] = useState(false);
    const [bridgeResults, setBridgeResults] = useState<string[]>([]);

    if (!isOpen) return null;

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const mockMeeting = {
                id: Date.now().toString(),
                timestamp: Date.now(),
                transcript,
                speakerNames,
                duration: 0,
                hasAudio: false
            };

            const options = {
                includeSpeakerLabels: includeSpeakers,
                includeTimestamps: includeTimestamps,
            };

            if (format === 'pdf') {
                const { content } = await exportMeetingAs(mockMeeting, 'pdf', options);
                await meetingExportPlugin.exportToPDF(content, `Meeting_Export_${mockMeeting.id}`);
                onClose();
            } else {
                const { content, extension } = await exportMeetingAs(mockMeeting, format as any, options);
                const filename = `meeting_${mockMeeting.id}.${extension}`;
                const filePath = await meetingExportPlugin.saveTextFile(content, filename);

                await meetingExportPlugin.shareFile(filePath, undefined, 'Share Meeting Export');

                if (onExportComplete) onExportComplete(filePath);
                onClose();
            }
        } catch (error) {
            logger.log('error', 'Export failed', error);
            alert('Export failed: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsExporting(false);
        }
    };

    const handleExtractAndBridge = () => {
        const transcriptText = transcript.map(s => {
            const name = speakerNames[s.speakerId] || `Speaker ${s.speakerId + 1}`;
            return `${name}: ${s.text}`;
        }).join('\n');

        const extracted = extractMeetingCandidates(transcriptText);
        setCandidates(extracted);
        setSelectedIndices(extracted.map((_, i) => i)); // all selected by default
        setIsBridgeScreen(true);
    };

    const handleSubmitBridge = async () => {
        if (!aimindmeshServer.enabled) {
            alert('AIMindMesh Server is currently disabled. Please enable it in Settings.');
            return;
        }

        setIsSubmittingBridge(true);
        setBridgeResults([]);
        let successCount = 0;
        let failCount = 0;
        const newResults: string[] = [];

        for (let i = 0; i < candidates.length; i++) {
            if (!selectedIndices.includes(i)) continue;
            const cand = candidates[i];

            try {
                if (cand.type === 'idea') {
                    await organizationApi.createIdea(aimindmeshServer, {
                        title: cand.title,
                        problemStatement: cand.summary,
                        summary: cand.summary,
                        sourceSignals: ['Extracted from meeting transcript'],
                        strategicScore: 65,
                        feasibilityScore: 60,
                        noveltyScore: 70,
                        overallScore: 65
                    });
                    newResults.push(`Submitted Idea: "${cand.title}"`);
                    successCount++;
                } else {
                    await organizationApi.createDirective(aimindmeshServer, {
                        title: cand.title,
                        description: cand.summary,
                        goalType: cand.type === 'directive' ? 'explore' : 'build',
                        priority: 50,
                        constraints: {}
                    });
                    newResults.push(`Submitted Directive: "${cand.title}"`);
                    successCount++;
                }
            } catch (error: any) {
                newResults.push(`Error submitting "${cand.title}": ${error.message}`);
                failCount++;
            }
        }

        setBridgeResults(newResults);
        setIsSubmittingBridge(false);

        if (failCount === 0 && successCount > 0) {
            alert(`Successfully proposed ${successCount} item(s) to the AI Council!`);
            setIsBridgeScreen(false);
            onClose();
        }
    };

    const toggleCandidate = (index: number) => {
        if (selectedIndices.includes(index)) {
            setSelectedIndices(selectedIndices.filter(i => i !== index));
        } else {
            setSelectedIndices([...selectedIndices, index]);
        }
    };

    const formats: { id: string; label: string; desc: string }[] = [
        { id: 'markdown', label: 'Markdown (.md)', desc: 'Best for notes and documentation' },
        { id: 'pdf', label: 'PDF Document (.pdf)', desc: 'Professional printable report' },
        { id: 'srt', label: 'Subtitles (.srt)', desc: 'Standard video subtitle format' },
        { id: 'vtt', label: 'Web Video Subtitles (.vtt)', desc: 'For web video players' },
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

                {/* Body */}
                <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6">
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
                                    onClick={handleExtractAndBridge}
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
                    ) : (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-text-secondary font-bold uppercase tracking-wider">
                                    Extracted Candidates ({candidates.length})
                                </span>
                                <button
                                    onClick={() => setIsBridgeScreen(false)}
                                    className="text-xs text-primary font-semibold hover:underline"
                                >
                                    Back to Export
                                </button>
                            </div>

                            {candidates.length === 0 ? (
                                <div className="text-center py-6 text-text-secondary bg-white/5 rounded-xl border border-white/10">
                                    No clear goals or ideas detected in the transcript.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {candidates.map((cand, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => toggleCandidate(idx)}
                                            className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${selectedIndices.includes(idx)
                                                ? 'border-primary/40 bg-primary/5'
                                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedIndices.includes(idx)}
                                                readOnly
                                                className="mt-1 w-4 h-4 accent-primary"
                                            />
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${cand.type === 'idea'
                                                        ? 'bg-purple-500/20 text-purple-300'
                                                        : 'bg-blue-500/20 text-blue-300'
                                                        }`}>
                                                        {cand.type}
                                                    </span>
                                                    <span className="text-xs text-text-secondary">
                                                        Confidence: {Math.round(cand.confidence * 100)}%
                                                    </span>
                                                </div>
                                                <h4 className="text-sm font-semibold text-white">{cand.title}</h4>
                                                <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                                                    {cand.summary}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {bridgeResults.length > 0 && (
                                <div className="p-3 bg-black/40 rounded-xl border border-white/10 text-xs space-y-1">
                                    <span className="font-bold text-text-secondary block mb-1">Submission Logs:</span>
                                    {bridgeResults.map((res, i) => (
                                        <div key={i} className="text-text-secondary">{res}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 pt-2 border-t border-white/10 bg-surface-hover">
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
                    ) : (
                        <button
                            onClick={handleSubmitBridge}
                            disabled={isSubmittingBridge || selectedIndices.length === 0}
                            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 shadow-lg transition-all ${isSubmittingBridge || selectedIndices.length === 0
                                ? 'bg-white/10 text-text-secondary cursor-not-allowed'
                                : 'bg-primary text-white hover:brightness-110 active:scale-[0.98]'
                                }`}
                        >
                            {isSubmittingBridge ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    <span>Proposing to Council...</span>
                                </>
                            ) : (
                                <span>Propose Selected ({selectedIndices.length})</span>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExportBottomSheet;
