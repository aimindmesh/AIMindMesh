import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Play, CheckCircle2, XCircle,
  ExternalLink, Lock,
  ChevronRight, RefreshCw, Trash2
} from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { evolutionApi, adminApi } from '../services/api';
import { useAdminStore } from '../store/adminStore';
import { CategorizedSelector } from '../components/ui/CategorizedSelector';
import type { EvolutionCandidateRow, EvolutionProposalRow, ProtectedPathRow } from '@aimindmesh/api-types';
import { EvolutionStatsCard } from '../components/evolution/EvolutionStatsCard';
import { CandidateDetailModal } from '../components/evolution/CandidateDetailModal';
import { EvolutionEngineConfig } from '../components/evolution/EvolutionEngineConfig';
import { CANDIDATE_STATUS_COLOR, SEVERITY_COLOR, type SelectorConfig } from '../components/evolution/evolutionShared';



// ─── Types ───────────────────────────────────────────────────────────────────

// Raw rows from /api/evolution (server contract)
type EvolutionCandidate = EvolutionCandidateRow;
type EvolutionProposal = EvolutionProposalRow;
type ProtectedPath = ProtectedPathRow;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IMPACT_COLOR = (i: string) =>
  i === 'high' ? 'text-error' : i === 'medium' ? 'text-warning' : 'text-success';

const STATUS_LABEL_COLOR = (s: string) => {
  if (s === 'proposed') return 'bg-primary/20 text-primary';
  if (s === 'merged') return 'bg-success/20 text-success';
  return 'bg-error/20 text-error';
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EvolutionView() {
  const { config, fetchConfig } = useAdminStore();
  const [candidates, setCandidates] = useState<EvolutionCandidate[]>([]);
  const [proposals, setProposals] = useState<EvolutionProposal[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<ProtectedPath[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<EvolutionCandidate | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedRouting, setSelectedRouting] = useState('AUTO');
  const [newPath, setNewPath] = useState('');
  const [newReason, setNewReason] = useState('');
  const [activeSection, setActiveSection] = useState<'candidates' | 'proposals' | 'paths' | 'config'>('candidates');
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectorConfig, setSelectorConfig] = useState<SelectorConfig | null>(null);

  // Local config state for editing
  const [localConfig, setLocalConfig] = useState<any>(null);

  useEffect(() => {
    if (config?.autoEvolution) {
      setLocalConfig({ ...config.autoEvolution });
    }
  }, [config]);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [candRes, propRes, pathRes, statusRes] = await Promise.all([
        evolutionApi.getCandidates(),
        evolutionApi.getProposals(),
        evolutionApi.getProtectedPaths(),
        adminApi.getStatus(),
      ]);
      setCandidates((candRes.data as any[]) || []);
      setProposals((propRes.data as any[]) || []);
      setProtectedPaths((pathRes.data as any[]) || []);
      setNodes((statusRes.data?.nodes as any[]) || []);
      fetchConfig();
    } catch (e) {
      console.error('[EvolutionView] fetch failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, [fetchConfig]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Android Back Button Handler ────────────────────────────────────────────
  useEffect(() => {
    let listenerHandle: any;
    const setup = async () => {
      listenerHandle = await CapApp.addListener('backButton', () => {
        if (selectedCandidate) {
          setSelectedCandidate(null);
          (window as any).__cap_back_handled = true;
          setTimeout(() => { (window as any).__cap_back_handled = false; }, 100);
        }
      });
    };
    setup();
    return () => { listenerHandle?.remove(); };
  }, [selectedCandidate]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRunCycle = async () => {
    setIsTriggering(true);
    try { await evolutionApi.runCycle(); } finally { setIsTriggering(false); }
  };

  const handleProcess = async (id: string) => {
    setProcessingId(id);
    try {
      await evolutionApi.processCandidate(id, { routing: selectedRouting === 'AUTO' ? undefined : selectedRouting });
      setSelectedCandidate(null);
      setTimeout(fetchAll, 1000);
    } finally {
      setProcessingId(null);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'delete') => {
    try {
      if (action === 'approve') await evolutionApi.approveProposal(id);
      else if (action === 'reject') await evolutionApi.rejectProposal(id);
      else if (action === 'delete') {
        if (confirm('Delete this proposal and close PR?')) await evolutionApi.deleteProposal(id);
        else return;
      }
      fetchAll();
    } catch (e) {
      console.error('[EvolutionView] action failed:', e);
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    if (!confirm('Delete this neural insight?')) return;
    try {
      await evolutionApi.deleteCandidate(id);
      setSelectedCandidate(null);
      fetchAll();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Delete failed'); // e.g. 409: the candidate has proposals
    }
  };

  const handleAddPath = async () => {
    if (!newPath.trim()) return;
    try {
      await evolutionApi.addProtectedPath(newPath, newReason);
      setNewPath('');
      setNewReason('');
      fetchAll();
    } catch (e) {
      console.error('[EvolutionView] add path failed:', e);
    }
  };

  const handleSaveConfig = async () => {
    if (!localConfig) return;
    setIsSavingConfig(true);
    try {
      await adminApi.patchConfig({ autoEvolution: localConfig });
      await fetchConfig();
    } catch (e) {
      console.error('[EvolutionView] save config failed:', e);
    } finally {
      setIsSavingConfig(false);
    }
  };


  const pendingCount = candidates.filter(c => c.status === 'pending').length;
  const activeCount = candidates.filter(c => ['generating', 'validating'].includes(c.status)).length;
  const openProposals = proposals.filter(p => p.status === 'proposed').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="view-content flex flex-col !overflow-hidden !pb-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-2xl border border-primary/20">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-black italic tracking-tight">Auto-Evolution</h1>
            <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground opacity-60">Autonomous Code Growth</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} disabled={isLoading} className="p-2 rounded-xl bg-surface border border-border/50 active:scale-95 transition-all">
            <RefreshCw size={14} className={isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'} />
          </button>
          <button
            onClick={handleRunCycle}
            disabled={isTriggering}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-[9px] font-black uppercase tracking-widest rounded-xl active:scale-95 transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
          >
            <Play size={11} className={isTriggering ? 'animate-spin' : ''} />
            {isTriggering ? 'Running...' : 'Run Cycle'}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3 shrink-0">
        {[
          { label: 'Pending', value: pendingCount, color: 'text-muted-foreground' },
          { label: 'Active', value: activeCount, color: 'text-warning' },
          { label: 'Open PRs', value: openProposals, color: 'text-primary' },
        ].map(s => (
          <div key={s.label} className="glass-panel rounded-2xl p-3 flex flex-col gap-1 text-center">
            <span className={`text-xl font-black ${s.color}`}>{s.value}</span>
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground opacity-60">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Section Tabs */}
      <div className="flex px-4 gap-1 mb-2 shrink-0 overflow-x-auto custom-scrollbar no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        {(['candidates', 'proposals', 'paths', 'config'] as const).map(s => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`shrink-0 px-4 py-2 text-[8px] font-black uppercase tracking-widest rounded-xl transition-all border ${
              activeSection === s ? 'bg-primary/20 text-primary border-primary/30' : 'bg-surface text-muted-foreground border-transparent'
            }`}
          >
            {s === 'candidates' ? 'Candidates' : s === 'proposals' ? 'Proposals' : s === 'paths' ? 'Protected' : 'Engine'}
          </button>
        ))}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3 custom-scrollbar" style={{ paddingBottom: 'var(--nav-height)' }}>

        {/* ── CANDIDATES ─────────────────────────────────────────────────── */}
        {activeSection === 'candidates' && (
          <>
            <EvolutionStatsCard />
            {candidates.length === 0 && !isLoading && (
              <div className="text-center py-12 text-muted-foreground text-[10px] italic opacity-50">No candidates detected.</div>
            )}
            {candidates.map(cand => (
              <button
                key={cand.id}
                onClick={() => setSelectedCandidate(cand)}
                className="w-full text-left p-4 glass-panel rounded-2xl border border-white/5 hover:border-primary/20 active:scale-[0.98] transition-all flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-md ${SEVERITY_COLOR(cand.severity)}`}>
                      SEV {cand.severity}
                    </span>
                    <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-md ${CANDIDATE_STATUS_COLOR(cand.status)}`}>
                      {cand.status}
                    </span>
                  </div>
                  <p className="text-xs font-black italic truncate">{cand.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{cand.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="w-12 h-1 bg-surface rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${cand.confidence * 100}%` }} />
                  </div>
                  <span className="text-[8px] font-mono opacity-40">{(cand.confidence * 100).toFixed(0)}%</span>
                </div>
                <ChevronRight size={14} className="text-muted-foreground/40 shrink-0" />
              </button>
            ))}
          </>
        )}

        {/* ── PROPOSALS ──────────────────────────────────────────────────── */}
        {activeSection === 'proposals' && (
          <>
            {proposals.length === 0 && !isLoading && (
              <div className="text-center py-12 text-muted-foreground text-[10px] italic opacity-50">No proposals found.</div>
            )}
            {proposals.map(prop => (
              <div key={prop.id} className="glass-panel rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS_LABEL_COLOR(prop.status)}`}>
                        {prop.status}
                      </span>
                      <span className="text-[8px] font-mono opacity-40">PR #{prop.pr_number}</span>
                    </div>
                    <p className="text-xs font-black italic truncate">{prop.candidate_title}</p>
                  </div>
                  <button 
                    onClick={() => Browser.open({ url: prop.pr_url })}
                    className="p-2 bg-surface border border-border rounded-xl active:scale-95 transition-all shrink-0"
                  >
                    <ExternalLink size={12} />
                  </button>
                </div>

                <p className="text-[10px] text-muted-foreground italic line-clamp-2">"{prop.explanation}"</p>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[8px] uppercase tracking-widest opacity-40 block">Impact</span>
                    <span className={`text-xs font-black uppercase ${IMPACT_COLOR(prop.impact)}`}>{prop.impact}</span>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase tracking-widest opacity-40 block">Breaking</span>
                    <span className="text-xs font-black">{prop.breaking_change ? '⚠️ YES' : 'NO'}</span>
                  </div>
                </div>

                {prop.status === 'proposed' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(prop.id, 'approve')}
                      className="flex-1 py-3 bg-success text-white text-[9px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                    >
                      <CheckCircle2 size={11} /> Approve
                    </button>
                    <button
                      onClick={() => handleAction(prop.id, 'reject')}
                      className="flex-1 py-3 bg-surface border border-border text-[9px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                    >
                      <XCircle size={11} /> Reject
                    </button>
                    <button
                      onClick={() => handleAction(prop.id, 'delete')}
                      className="px-4 py-3 bg-surface border border-border text-error/60 rounded-xl active:scale-95 transition-all"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
                {prop.status !== 'proposed' && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleAction(prop.id, 'delete')}
                      className="p-2 text-error/40 hover:text-error active:scale-95 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* ── PROTECTED PATHS ────────────────────────────────────────────── */}
        {activeSection === 'paths' && (
          <>
            <div className="glass-panel rounded-2xl p-4 border border-warning/20 flex flex-col gap-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-warning flex items-center gap-2">
                <Lock size={12} /> Protected Areas
              </h3>
              <input
                placeholder="Path glob (e.g. src/db/**)"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl p-3 text-xs font-mono outline-none focus:border-warning/50"
              />
              <div className="flex gap-2">
                <input
                  placeholder="Reason..."
                  value={newReason}
                  onChange={e => setNewReason(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-xl p-3 text-xs italic outline-none focus:border-warning/50"
                />
                <button
                  onClick={handleAddPath}
                  className="px-4 py-3 bg-warning/20 text-warning border border-warning/30 rounded-xl text-[10px] font-black active:scale-95 transition-all"
                >
                  Add
                </button>
              </div>
              <div className="p-3 bg-warning/5 border border-warning/20 rounded-xl">
                <p className="text-[9px] text-warning/70 italic">
                  <span className="font-black">NOTE:</span> .noautoedit file takes precedence.
                </p>
              </div>
            </div>

            {protectedPaths.map(p => (
              <div key={p.path} className="glass-panel rounded-2xl p-4 border border-white/5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono truncate">{p.path}</p>
                  {p.reason && <p className="text-[9px] italic opacity-40 truncate">{p.reason}</p>}
                </div>
                <button
                  onClick={() => evolutionApi.deleteProtectedPath(p.path).then(fetchAll)}
                  className="p-2 text-error/40 hover:text-error active:scale-95 transition-all"
                >
                  <XCircle size={14} />
                </button>
              </div>
            ))}

            {protectedPaths.length === 0 && !isLoading && (
              <div className="text-center py-8 text-muted-foreground text-[10px] italic opacity-50">No protected paths configured.</div>
            )}
          </>
        )}

        {/* ── CONFIG ─────────────────────────────────────────────────────── */}
        {activeSection === 'config' && localConfig && (
          <EvolutionEngineConfig
            localConfig={localConfig}
            setLocalConfig={setLocalConfig}
            nodes={nodes}
            isSavingConfig={isSavingConfig}
            handleSaveConfig={handleSaveConfig}
            setSelectorConfig={setSelectorConfig}
            setIsSelectorOpen={setIsSelectorOpen}
          />
        )}
      </div>

      {/* ── CANDIDATE DETAIL MODAL ─────────────────────────────────────── */}
      {selectedCandidate && (
        <CandidateDetailModal
          selectedCandidate={selectedCandidate}
          setSelectedCandidate={setSelectedCandidate}
          nodes={nodes}
          selectedRouting={selectedRouting}
          setSelectedRouting={setSelectedRouting}
          setSelectorConfig={setSelectorConfig}
          setIsSelectorOpen={setIsSelectorOpen}
          processingId={processingId}
          handleProcess={handleProcess}
          handleDeleteCandidate={handleDeleteCandidate}
        />
      )}

      {/* Selector Modal Overlay */}
      {isSelectorOpen && selectorConfig && (
        <CategorizedSelector
          isOpen={isSelectorOpen}
          onClose={() => setIsSelectorOpen(false)}
          title={selectorConfig.title}
          groups={selectorConfig.groups}
          currentValue={selectorConfig.currentValue}
          onSelect={selectorConfig.onSelect}
        />
      )}
    </div>
  );
}
