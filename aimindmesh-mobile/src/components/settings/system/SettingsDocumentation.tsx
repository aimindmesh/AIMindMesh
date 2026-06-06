import React from 'react';
import ReactMarkdown from 'react-markdown';
import { DOCUMENTATION_CONTENT } from '../../../data/DocumentationData';

interface SettingsDocumentationProps {
    onExportDocs: () => Promise<void>;
}

const SettingsDocumentation: React.FC<SettingsDocumentationProps> = ({ onExportDocs }) => {
    return (
        <div className="flex flex-col h-full bg-background relative">
            <div className="flex justify-between items-center p-4 border-b border-white/10 shrink-0 sticky top-0 bg-background/95 backdrop-blur z-10">
                <h3 className="text-lg font-bold text-primary">App Documentation</h3>
                <button
                    onClick={onExportDocs}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-all text-sm font-medium"
                    title="Export as .txt"
                >
                    <span>📥 Export to Text</span>
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
                <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:text-primary prose-a:text-blue-400 prose-code:bg-white/10 prose-code:rounded prose-code:px-1 prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10">
                    <ReactMarkdown>{DOCUMENTATION_CONTENT}</ReactMarkdown>
                </article>
            </div>
        </div>
    );
};

export default SettingsDocumentation;
