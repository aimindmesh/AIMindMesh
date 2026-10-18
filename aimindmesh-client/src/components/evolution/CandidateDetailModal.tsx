import { Activity, Hash, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { EvolutionCandidateRow } from '@aimindmesh/api-types';
import { sourceLabel } from './EvolutionStatsCard';

interface CandidateDetailModalProps {
  selectedCandidate: EvolutionCandidateRow;
  setSelectedCandidate: (candidate: EvolutionCandidateRow | null) => void;
  handleDeleteCandidate: (id: string) => void;
  handleProcessCandidate: (id: string) => void;
  isProcessingSpecific: string | null;
}

/** Detail of an evolution candidate: description, approach, target; process it now or delete it. */
export function CandidateDetailModal({ selectedCandidate, setSelectedCandidate, handleDeleteCandidate, handleProcessCandidate, isProcessingSpecific }: CandidateDetailModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-background/95 backdrop-blur-2xl animate-in fade-in duration-300">
      <div className="w-full max-w-3xl bg-surface rounded-[48px] border border-primary/20 shadow-2xl shadow-primary/30 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">

        {/* Modal Header */}
        <div className="p-8 border-b border-border flex justify-between items-center bg-background/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/20 rounded-2xl text-primary">
              <Activity size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-black italic tracking-tight">{selectedCandidate.title}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] font-black uppercase bg-background px-3 py-1 rounded-full border border-border">Candidate ID: {selectedCandidate.id.slice(0, 8)}</span>
                <span className="text-[10px] font-black uppercase bg-primary/10 text-primary px-3 py-1 rounded-full">Severity {selectedCandidate.severity}</span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setSelectedCandidate(null)}
            className="p-3 hover:bg-surface-hover rounded-full transition-all"
          >
            <XCircle size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-10 custom-scrollbar flex flex-col gap-10">

          <div className="flex flex-col gap-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Problem Description</h4>
            <p className="text-sm leading-relaxed text-foreground font-medium italic">"{selectedCandidate.description}"</p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="flex flex-col gap-3">
                <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Target Component</h4>
                <div className="p-4 bg-[#0a0c14] rounded-2xl border border-white/10 font-mono text-[10px] text-white font-bold break-all shadow-inner min-h-[60px] flex items-center">
                    {selectedCandidate.target_component || selectedCandidate.target_component || 'Global System'}
                </div>
            </div>
            <div className="flex flex-col gap-3">
                <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Inference Source</h4>
                <div className="p-4 bg-[#0a0c14] rounded-2xl border border-white/10 font-mono text-[10px] uppercase italic tracking-wider text-white font-bold break-all shadow-inner min-h-[60px] flex items-center">
                    {sourceLabel(selectedCandidate.source)}
                </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Proposed Architectural Approach</h4>
            <div className="p-6 bg-background/80 border border-primary/20 rounded-[32px] text-sm leading-relaxed whitespace-pre-wrap shadow-inner">
              {selectedCandidate.proposed_approach || 'Architectural strategy pending final synthesis...'}
            </div>
          </div>

          {selectedCandidate.tags && (
            <div className="flex flex-col gap-3">
                <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Neural Tags</h4>
                <div className="flex flex-wrap gap-2">
                    {JSON.parse(selectedCandidate.tags).map((tag: string) => (
                        <span key={tag} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-xl text-[10px] font-black uppercase tracking-widest italic">
                            <Hash size={10} className="text-primary" /> {tag}
                        </span>
                    ))}
                </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-8 border-t border-border flex gap-4 bg-background/50">
            <button 
                onClick={() => handleDeleteCandidate(selectedCandidate.id)}
                className="px-6 py-5 bg-surface-hover border border-border text-error text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-error/10 transition-all flex items-center gap-3"
            >
                <Trash2 size={16} /> Delete
            </button>
            <button 
                onClick={() => handleProcessCandidate(selectedCandidate.id)}
                disabled={isProcessingSpecific !== null}
                className="flex-1 py-5 bg-primary text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-primary-hover transition-all active:scale-95 shadow-xl shadow-primary/30 flex items-center justify-center gap-4 disabled:opacity-50"
            >
                {isProcessingSpecific === selectedCandidate.id ? (
                    <>
                        <Activity className="animate-spin" size={18} />
                        Generating Evolution...
                    </>
                ) : (
                    <>
                        <Sparkles size={18} />
                        Trigger Implementation
                    </>
                )}
            </button>
            <button 
                onClick={() => setSelectedCandidate(null)}
                className="px-10 py-5 bg-surface-hover border border-border text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-background transition-all"
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
}
