import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Play, CheckCircle2, XCircle,
  ExternalLink, Lock, Activity, Sparkles, Hash,
  ChevronRight, RefreshCw, Save, Clock, Trash2
} from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { evolutionApi, adminApi } from '../services/api';
import { useAdminStore } from '../store/adminStore';
import { CategorizedSelector, SelectorGroup } from '../components/ui/CategorizedSelector';



// ─── Types ───────────────────────────────────────────────────────────────────

interface EvolutionCandidate {
  id: string;
  title: string;
  description: string;
  severity: number;
  confidence: number;
  status: string;
  source: string;
  proposed_approach?: string;
  target_component?: string;
  target_language?: string;
  tags?: string;
  created_at: number;
}

interface EvolutionProposal {
  id: string;
  candidate_id: string;
  candidate_title: string;
  explanation: string;
  branch_name: string;
  pr_url: string;
  pr_number: number;
  target_component: string;
  impact: string;
  breaking_change: boolean;
  status: 'proposed' | 'merged' | 'rejected' | 'failed';
  created_at: number;
}

interface ProtectedPath {
  path: string;
  reason: string;
  created_at: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_COLOR = (s: number) =>
  s >= 8 ? 'bg-error/20 text-error' : s >= 5 ? 'bg-warning/20 text-warning' : 'bg-primary/20 text-primary';

const IMPACT_COLOR = (i: string) =>
  i === 'high' ? 'text-error' : i === 'medium' ? 'text-warning' : 'text-success';

const STATUS_LABEL_COLOR = (s: string) => {
  if (s === 'proposed') return 'bg-primary/20 text-primary';
  if (s === 'merged') return 'bg-success/20 text-success';
  return 'bg-error/20 text-error';
};

const CANDIDATE_STATUS_COLOR = (s: string) => {
  if (s === 'pending') return 'bg-surface text-muted-foreground';
  if (s === 'generating') return 'bg-warning/20 text-warning';
  if (s === 'validating') return 'bg-primary/20 text-primary';
  if (s === 'proposed') return 'bg-success/20 text-success';
  if (s === 'failed') return 'bg-error/20 text-error';
  return 'bg-surface text-muted-foreground';
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
  const [selectorConfig, setSelectorConfig] = useState<{ title: string; groups: SelectorGroup[]; onSelect: (v: string) => void; currentValue: string } | null>(null);

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
    } catch (e) {
      console.error('[EvolutionView] delete candidate failed:', e);
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
          <div className="flex flex-col gap-4 pb-4">
            <div className="glass-panel p-5 rounded-3xl border border-white/5 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-primary">Engine Control</h3>
                  <p className="text-[9px] text-muted-foreground italic">Autonomous status</p>
                </div>
                <button
                  onClick={() => setLocalConfig({ ...localConfig, enabled: !localConfig.enabled })}
                  className={`w-12 h-6 rounded-full p-1 transition-all ${localConfig.enabled ? 'bg-primary' : 'bg-surface border border-border'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-all ${localConfig.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Preferred Routing</label>
                  <button
                    onClick={() => {
                      const groups: SelectorGroup[] = [
                        {
                          label: 'System',
                          options: [{ label: 'AUTOMATIC', value: 'AUTO', description: 'Dynamic allocation' }]
                        },
                        {
                          label: 'Available Nodes',
                          options: nodes.map(n => ({ 
                            label: n.id === 'SERVER_LOCAL' ? 'OLLAMA' : (n.type === 'pc_client' || n.id === 'LAPTOP') ? 'LAPTOP' : n.id.toUpperCase(), 
                            value: n.id, 
                            description: n.url 
                          }))
                        },
                        {
                          label: 'Cloud Fallback',
                          options: [
                            { label: 'GEMINI', value: 'GEMINI_API', description: 'Google AI' },
                            { label: 'OPENROUTER', value: 'OPENROUTER_API', description: 'Multi-provider' },
                            { label: 'FREELLMAPI', value: 'FREELLMAPI', description: 'FreeLLMAPI Gateway' }
                          ]
                        }
                      ];
                      setSelectorConfig({
                        title: 'Select Preferred Node',
                        groups,
                        currentValue: localConfig.preferredNode || 'AUTO',
                        onSelect: (v) => setLocalConfig({ ...localConfig, preferredNode: v })
                      });
                      setIsSelectorOpen(true);
                    }}
                    className="w-full bg-surface border border-border rounded-xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all"
                  >
                    <span className="text-[11px] font-black uppercase tracking-widest">{localConfig.preferredNode || 'AUTO'}</span>
                    <ChevronRight size={14} className="text-muted-foreground opacity-30 group-hover:opacity-100" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Daily PR Limit</label>
                    <input
                      type="number"
                      value={localConfig.maxProposalsPerDay || 3}
                      onChange={e => setLocalConfig({ ...localConfig, maxProposalsPerDay: parseInt(e.target.value) })}
                      className="w-full bg-surface border border-border rounded-xl p-3 text-xs font-black outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Min Severity</label>
                    <input
                      type="number"
                      min="1" max="10"
                      value={localConfig.minSeverityThreshold || 6}
                      onChange={e => setLocalConfig({ ...localConfig, minSeverityThreshold: parseInt(e.target.value) })}
                      className="w-full bg-surface border border-border rounded-xl p-3 text-xs font-black outline-none focus:border-primary/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1 block">Cron Schedule</label>
                  <div className="flex items-center gap-2 bg-surface border border-border rounded-xl p-3">
                    <Clock size={12} className="text-muted-foreground" />
                    <input
                      type="text"
                      value={localConfig.cronExpression || '0 3 * * *'}
                      onChange={e => setLocalConfig({ ...localConfig, cronExpression: e.target.value })}
                      className="flex-1 bg-transparent text-xs font-mono outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-surface/50 rounded-2xl border border-border/30">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest">Shadow Mode</p>
                    <p className="text-[8px] text-muted-foreground italic">Validate without merging</p>
                  </div>
                  <button
                    onClick={() => setLocalConfig({ ...localConfig, shadowMode: !localConfig.shadowMode })}
                    className={`w-10 h-5 rounded-full p-1 transition-all ${localConfig.shadowMode ? 'bg-warning' : 'bg-surface border border-border'}`}
                  >
                    <div className={`w-3 h-3 bg-white rounded-full transition-all ${localConfig.shadowMode ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              <button
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="btn-primary w-full py-4 mt-2"
              >
                {isSavingConfig ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
                {isSavingConfig ? 'Saving...' : 'Save Engine Config'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── CANDIDATE DETAIL MODAL ─────────────────────────────────────── */}
      {selectedCandidate && (
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
                  {selectedCandidate.source?.replace('_', ' ')}
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
                        { label: 'FREELLMAPI', value: 'FREELLMAPI', description: 'FreeLLMAPI Gateway' }
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
