/**
 * ArtifactViewer.tsx
 *
 * Visualizzatore di output AI (Markdown, JSON, Plain).
 */

import React from 'react';

interface Props {
  content:   string | null;
  isLoading: boolean;
  format:    'markdown' | 'json' | 'plain';
}

const ArtifactViewer: React.FC<Props> = ({ content, isLoading, format }) => {
  if (isLoading) {
    return (
      <div className="p-4 bg-black/40 rounded-xl animate-pulse border border-white/5">
        <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Syncing artifact...</p>
        </div>
      </div>
    );
  }

  if (!content) return null;

  const formattedContent = format === 'json'
    ? (() => { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } })()
    : content;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    // Potresti aggiungere un toast qui se disponibile nel progetto
  };

  return (
    <div className="relative group overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-inner">
      <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{format} output</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] font-bold text-primary hover:text-primary-hover transition-colors uppercase tracking-wider flex items-center gap-1.5"
        >
          📋 Copy Artifact
        </button>
      </div>
      <pre className="max-h-[500px] overflow-y-auto p-4 text-[11px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed custom-scrollbar selection:bg-primary/30">
        {formattedContent}
      </pre>
    </div>
  );
};

export default ArtifactViewer;
