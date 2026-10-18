import { Activity, ChevronRight, Hash, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { EvolutionCandidateRow } from '@aimindmesh/api-types';
import type { SelectorGroup } from '../ui/CategorizedSelector';
import { sourceLabel } from './EvolutionStatsCard';
import { CANDIDATE_STATUS_COLOR, SEVERITY_COLOR, type SelectorConfig } from './evolutionShared';

interface CandidateDetailModalProps {
  selectedCandidate: EvolutionCandidateRow;
  setSelectedCandidate: (candidate: EvolutionCandidateRow | null) => void;
  nodes: any[];
  selectedRouting: string;
  setSelectedRouting: (routing: string) => void;
  setSelectorConfig: (config: SelectorConfig | null) => void;
  setIsSelectorOpen: (open: boolean) => void;
  processingId: string | null;
  handleProcess: (id: string) => void;
  handleDeleteCandidate: (id: string) => void;
}

/** Full-screen detail of an evolution candidate: description, approach, route and process it, or delete it. */
export function CandidateDetailModal({
  selectedCandidate, setSelectedCandidate, nodes, selectedRouting, setSelectedRouting,
  setSelectorConfig, setIsSelectorOpen, processingId, handleProcess, handleDeleteCandidate,
}: CandidateDetailModalProps) {
  return (
    <div 
      className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-2xl animate-in slide-in-from-bottom-8 duration-300"
      style={{ 
        paddingTop: 'var(--safe-area-top)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)' 
      }}
    >
      {/* Modal Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-primary/20 rounded-xl shrink-0">
            <Activity size={16} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black italic truncate">{selectedCandidate.title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${SEVERITY_COLOR(selectedCandidate.severity)}`}>
                Severity {selectedCandidate.severity}
              </span>
              <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${CANDIDATE_STATUS_COLOR(selectedCandidate.status)}`}>
                {selectedCandidate.status}
              </span>
            </div>
          </div>
        </div>
        <button onClick={() => setSelectedCandidate(null)} className="p-2 rounded-xl bg-surface border border-border active:scale-95 transition-all shrink-0">
          <XCircle size={18} />
        </button>
      </div>

      {/* Modal Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar space-y-5">
        <div>
          <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Description</h4>
          <p className="text-sm leading-relaxed text-foreground italic">"{selectedCandidate.description}"</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Target</h4>
            <div className="p-4 bg-surface-lighter border border-border/50 rounded-2xl font-mono text-[10px] break-all text-white shadow-sm">
              {selectedCandidate.target_component || 'Global'}
            </div>
          </div>
          <div>
            <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Source</h4>
            <div className="p-4 bg-surface-lighter border border-border/50 rounded-2xl font-mono text-[10px] uppercase italic text-white/90 shadow-sm">
              {sourceLabel(selectedCandidate.source)}
            </div>
          </div>
        </div>

        {selectedCandidate.proposed_approach && (
          <div>
            <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Proposed Approach</h4>
            <div className="p-4 bg-background/80 border border-primary/20 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap">
              {selectedCandidate.proposed_approach}
            </div>
          </div>
        )}

        {selectedCandidate.tags && (() => {
          try {
            const tags: string[] = JSON.parse(selectedCandidate.tags);
            return (
              <div>
                <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-border rounded-xl text-[9px] font-black uppercase tracking-widest italic">
                      <Hash size={8} className="text-primary" /> {tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          } catch { return null; }
        })()}

        {/* Routing Selector */}
        <div>
          <h4 className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-2">Inference Node</h4>
          <button
            onClick={() => {
              const groups: SelectorGroup[] = [
                {
                  label: 'Cluster',
                  options: [
                    { label: 'AUTO (Balanced)', value: 'AUTO', description: 'System-selected' },
                    ...nodes.map(n => ({ 
                      label: n.id === 'SERVER_LOCAL' ? 'OLLAMA' : (n.type === 'pc_client' || n.id === 'LAPTOP') ? 'LAPTOP' : n.id.toUpperCase(), 
                      value: n.id, 
                      description: n.url 
                    }))
                  ]
                },
                {
                  label: 'Cloud Providers',
                  options: [
                    { label: 'GEMINI', value: 'GEMINI_API', description: 'Google Cloud' },
                    { label: 'OPENROUTER', value: 'OPENROUTER_API', description: 'Multi-model fallback' },
                    { label: 'FREELLMAPI', value: 'FREELLMAPI', description: 'FreeLLMAPI Gateway' },
                    { label: 'CLAUDE', value: 'CLAUDE', description: 'Anthropic API credit' }
                  ]
                }
              ];
              setSelectorConfig({
                title: 'Route Task',
                groups,
                currentValue: selectedRouting,
                onSelect: (v) => setSelectedRouting(v)
              });
              setIsSelectorOpen(true);
            }}
            className="w-full bg-surface border border-border rounded-xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all"
          >
            <span className="text-[11px] font-black uppercase tracking-widest">{selectedRouting}</span>
            <ChevronRight size={14} className="text-muted-foreground opacity-30 group-hover:opacity-100" />
          </button>
        </div>
      </div>

      {/* Modal Footer */}
      <div className="px-4 pb-6 pt-3 border-t border-border flex gap-3 shrink-0">
        <button
          onClick={() => handleProcess(selectedCandidate.id)}
          disabled={processingId !== null}
          className="flex-1 py-4 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 shadow-xl shadow-primary/30"
        >
          {processingId === selectedCandidate.id ? (
            <><Activity className="animate-spin" size={14} /> Generating...</>
          ) : (
            <><Sparkles size={14} /> Trigger Implementation</>
          )}
        </button>
        <button
          onClick={() => handleDeleteCandidate(selectedCandidate.id)}
          className="px-5 py-4 bg-surface border border-border text-error rounded-2xl active:scale-95 transition-all"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={() => setSelectedCandidate(null)}
          className="px-6 py-4 bg-surface border border-border text-[10px] font-black uppercase tracking-widest rounded-2xl active:scale-95 transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
}
