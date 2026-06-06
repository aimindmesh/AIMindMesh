import React from 'react';
import { SparklesIcon } from '../../constants';

interface MeetingAnalysisPanelProps {
    showAnalysis: boolean;
    setShowAnalysis: (show: boolean) => void;
    isAnalyzing: boolean;
    analysisResult: string;
}

const MeetingAnalysisPanel: React.FC<MeetingAnalysisPanelProps> = ({
    showAnalysis,
    setShowAnalysis,
    isAnalyzing,
    analysisResult
}) => {
    if (!showAnalysis) return null;

    return (
        <div className="w-full md:w-1/3 border-l border-surface bg-surface/10 flex flex-col">
            <div className="p-4 border-b border-surface flex justify-between items-center">
                <h3 className="font-bold text-white flex items-center gap-2">
                    <SparklesIcon className="w-5 h-5 text-yellow-400" />
                    LLM Analysis
                </h3>
                <button onClick={() => setShowAnalysis(false)} className="md:hidden text-text-secondary">
                    Close
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm text-text-primary whitespace-pre-wrap">
                {isAnalyzing && !analysisResult ? (
                    <div className="flex items-center justify-center h-full gap-2 text-text-secondary">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
                        Starting analysis...
                    </div>
                ) : (
                    <>
                        {analysisResult}
                        {isAnalyzing && (
                            <span className="inline-flex items-center gap-1 text-text-secondary ml-1">
                                <span className="animate-pulse">▌</span>
                            </span>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default MeetingAnalysisPanel;
