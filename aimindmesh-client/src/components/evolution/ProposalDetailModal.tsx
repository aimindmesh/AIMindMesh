import { CheckCircle2, ChevronRight, ExternalLink, GitPullRequest, XCircle } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { EvolutionProposalRow } from '@aimindmesh/api-types';

interface ProposalDetailModalProps {
  selectedProposal: EvolutionProposalRow;
  setSelectedProposal: (proposal: EvolutionProposalRow | null) => void;
  handleAction: (id: string, action: 'approve' | 'reject') => void;
}

/** Detail of an evolution proposal (pull request): files, reasoning, approve or reject. */
export function ProposalDetailModal({ selectedProposal, setSelectedProposal, handleAction }: ProposalDetailModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-background/95 backdrop-blur-2xl animate-in fade-in duration-300">
      <div className="w-full max-w-3xl bg-surface rounded-[48px] border border-primary/20 shadow-2xl shadow-primary/30 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-300">

        {/* Modal Header */}
        <div className="p-8 border-b border-border flex justify-between items-center bg-background/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-warning/20 rounded-2xl text-warning">
              <GitPullRequest size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-black italic tracking-tight">{selectedProposal.candidate_title}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] font-black uppercase bg-background px-3 py-1 rounded-full border border-border">PR #{selectedProposal.pr_number}</span>
                <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${selectedProposal.status === 'proposed' ? 'bg-primary/20 text-primary' : 'bg-success/20 text-success'}`}>
                  {selectedProposal.status}
                </span>
              </div>
            </div>
          </div>
          <button 
            onClick={() => setSelectedProposal(null)}
            className="p-3 hover:bg-surface-hover rounded-full transition-all"
          >
            <XCircle size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-auto p-10 custom-scrollbar flex flex-col gap-8">

          <div className="flex flex-col gap-3">
            <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Original Problem</h4>
            <p className="text-sm leading-relaxed text-foreground font-medium italic">"{selectedProposal.candidate_description}"</p>
          </div>

          <div className="flex flex-col gap-4">
            <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Architectural Explanation</h4>
            <div className="p-6 bg-background/80 border border-primary/20 rounded-[32px] text-sm leading-relaxed whitespace-pre-wrap shadow-inner">
              {selectedProposal.explanation}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Target Component</span>
              <span className="text-xs font-mono font-bold">{selectedProposal.target_component}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Branch Name</span>
              <span className="text-xs font-mono font-bold">{selectedProposal.branch_name}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-40">System Impact</span>
              <span className={`text-xs font-black uppercase ${selectedProposal.impact === 'high' ? 'text-error' : 'text-success'}`}>{selectedProposal.impact}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Breaking Change</span>
              <span className="text-xs font-black uppercase">{selectedProposal.breaking_change ? '⚠️ YES' : 'NO'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-4 pt-4 border-t border-border">
            <h4 className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Gitea Integration</h4>
            <button 
              onClick={() => openUrl(selectedProposal.pr_url)} 
              className="flex items-center justify-between p-5 bg-surface border border-border rounded-2xl group hover:border-primary/40 transition-all text-left"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-background rounded-lg group-hover:text-primary transition-colors">
                  <ExternalLink size={20} />
                </div>
                <span className="text-sm font-bold">Review code changes in Gitea</span>
              </div>
              <ChevronRight size={20} className="opacity-40" />
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-8 border-t border-border flex gap-4 bg-background/50">
            {selectedProposal.status === 'proposed' && (
              <>
                <button 
                    onClick={() => { handleAction(selectedProposal.id, 'approve'); setSelectedProposal(null); }}
                    className="flex-1 py-5 bg-success text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-success/80 transition-all shadow-xl shadow-success/20 flex items-center justify-center gap-4"
                >
                    <CheckCircle2 size={18} /> Approve & Merge
                </button>
                <button 
                    onClick={() => { handleAction(selectedProposal.id, 'reject'); setSelectedProposal(null); }}
                    className="flex-1 py-5 bg-surface-hover border border-border text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-error/10 hover:text-error hover:border-error/20 transition-all flex items-center justify-center gap-4"
                >
                    <XCircle size={18} /> Reject
                </button>
              </>
            )}
            <button 
                onClick={() => setSelectedProposal(null)}
                className="px-10 py-5 bg-surface-hover border border-border text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl hover:bg-background transition-all ml-auto"
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
}
