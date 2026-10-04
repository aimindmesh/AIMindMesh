import React, { useState } from 'react';
import { MeetingAnalysis, TranscriptSegment } from '../../types/meeting';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { AIMindMeshServerSettings, DEFAULT_AIMINDMESH_SERVER_SETTINGS } from '../../types';
import { candidatesFromAnalysis, extractMeetingCandidates, MeetingActionCandidate } from '../../services/meetingOrganizationBridge';
import { organizationApi } from '../../services/organizationApi';
import { speakerLabel } from '../../services/meeting/speakerEdits';
import { showAlert } from '../../services/ui/dialogs';

interface MeetingCouncilBridgeProps {
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    analysis: MeetingAnalysis | null;
    onBack: () => void;
    onDone: () => void;
}

/** Goals and ideas of a meeting proposed to the AI Council (organization layer of the server). */
const MeetingCouncilBridge: React.FC<MeetingCouncilBridgeProps> = ({ transcript, speakerNames, analysis, onBack, onDone }) => {
    const [aimindmeshServer] = useLocalStorage<AIMindMeshServerSettings>('aimindmesh-server-settings', DEFAULT_AIMINDMESH_SERVER_SETTINGS);
    // The AI notes' action items and decisions when there are any, else a keyword match
    const [candidates] = useState<MeetingActionCandidate[]>(() => {
        const fromNotes = candidatesFromAnalysis(analysis);
        if (fromNotes.length > 0) return fromNotes;
        return extractMeetingCandidates(transcript.map(s => `${speakerLabel(s.speakerId, speakerNames)}: ${s.text}`).join('\n'));
    });
    const [selectedIndices, setSelectedIndices] = useState<number[]>(() => candidates.map((_, i) => i));
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [results, setResults] = useState<string[]>([]);

    const toggle = (index: number) => setSelectedIndices(selected =>
        selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]);

    const submit = async () => {
        if (!aimindmeshServer.enabled) {
            await showAlert({ title: 'AIMindMesh Server is disabled', message: 'Enable it in Settings first.' });
            return;
        }
        setIsSubmitting(true);
        setResults([]);
        let successCount = 0;
        let failCount = 0;
        const newResults: string[] = [];
        for (const [i, cand] of candidates.entries()) {
            if (!selectedIndices.includes(i)) continue;
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
                } else {
                    await organizationApi.createDirective(aimindmeshServer, {
                        title: cand.title,
                        description: cand.summary,
                        goalType: cand.type === 'directive' ? 'explore' : 'build',
                        priority: 50,
                        constraints: {}
                    });
                    newResults.push(`Submitted Directive: "${cand.title}"`);
                }
                successCount++;
            } catch (error: any) {
                newResults.push(`Error submitting "${cand.title}": ${error.message}`);
                failCount++;
            }
        }
        setResults(newResults);
        setIsSubmitting(false);
        if (failCount === 0 && successCount > 0) {
            await showAlert({ title: `Proposed ${successCount} item(s) to the AI Council` });
            onDone();
        }
    };

    return (
        <>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
                <div className="flex justify-between items-center">
                    <span className="text-xs text-text-secondary font-bold uppercase tracking-wider">
                        {`${analysis && !analysis.markdown ? 'From the AI notes' : 'Extracted candidates'} (${candidates.length})`}
                    </span>
                    <button onClick={onBack} className="text-xs text-primary font-semibold hover:underline">
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
                                onClick={() => toggle(idx)}
                                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${selectedIndices.includes(idx)
                                    ? 'border-primary/40 bg-primary/5'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                    }`}
                            >
                                <input type="checkbox" checked={selectedIndices.includes(idx)} readOnly className="mt-1 w-4 h-4 accent-primary" />
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${cand.type === 'idea'
                                            ? 'bg-purple-500/20 text-purple-300'
                                            : 'bg-blue-500/20 text-blue-300'
                                            }`}>
                                            {cand.type}
                                        </span>
                                        <span className="text-xs text-text-secondary">{`Confidence: ${Math.round(cand.confidence * 100)}%`}</span>
                                    </div>
                                    <h4 className="text-sm font-semibold text-white">{cand.title}</h4>
                                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{cand.summary}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {results.length > 0 && (
                    <div className="p-3 bg-black/40 rounded-xl border border-white/10 text-xs space-y-1">
                        <span className="font-bold text-text-secondary block mb-1">Submission Logs:</span>
                        {results.map((res, i) => <div key={i} className="text-text-secondary">{res}</div>)}
                    </div>
                )}
            </div>

            <div className="p-6 pt-2 border-t border-white/10 bg-surface-hover">
                <button
                    onClick={submit}
                    disabled={isSubmitting || selectedIndices.length === 0}
                    className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 shadow-lg transition-all ${isSubmitting || selectedIndices.length === 0
                        ? 'bg-white/10 text-text-secondary cursor-not-allowed'
                        : 'bg-primary text-white hover:brightness-110 active:scale-[0.98]'
                        }`}
                >
                    {isSubmitting ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            <span>Proposing to Council...</span>
                        </>
                    ) : (
                        <span>{`Propose Selected (${selectedIndices.length})`}</span>
                    )}
                </button>
            </div>
        </>
    );
};

export default MeetingCouncilBridge;
