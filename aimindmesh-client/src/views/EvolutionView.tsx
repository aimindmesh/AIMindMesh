import { useState, useEffect } from 'react';
import { Cpu, GitPullRequest, ShieldCheck, Play, CheckCircle2, XCircle, ExternalLink, AlertTriangle, Terminal, Lock, Activity, Sparkles, Hash, ChevronRight, Trash2 } from 'lucide-react';
import { serverApi } from '../services/serverApi';
import { Dropdown } from '../components/ui/Dropdown';
import { Logger } from '../utils/logger';
import { openUrl } from '@tauri-apps/plugin-opener';

interface EvolutionProposal {
  id: string;
  candidate_id: string;
  candidate_title: string;
  candidate_description: string;
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

export default function EvolutionView() {
  const [proposals, setProposals] = useState<EvolutionProposal[]>([]);
  const [candidates, setCandidates] = useState<EvolutionCandidate[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<ProtectedPath[]>([]);
  const [, setIsLoading] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isProcessingSpecific, setIsProcessingSpecific] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const [newReason, setNewReason] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<EvolutionCandidate | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<EvolutionProposal | null>(null);
  const [localNodes, setLocalNodes] = useState<any[]>([]);
  const [serverConfig, setServerConfig] = useState<any>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const fetchEvolutionData = async () => {
    setIsLoading(true);
    try {
      const [propRes, candRes, pathRes] = await Promise.all([
        serverApi.get('/api/evolution/proposals'),
        serverApi.get('/api/evolution/candidates'),
        serverApi.get('/api/evolution/protected-paths')
      ]);
      setProposals(propRes.data);
      setCandidates(candRes.data);
      setProtectedPaths(pathRes.data);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to fetch evolution data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await serverApi.get('/api/admin/status');
      setLocalNodes(res.data.nodes || []);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to fetch server status');
    }
  };

  const fetchServerConfig = async () => {
    try {
      const res = await serverApi.get('/api/admin/config');
      setServerConfig(res.data.config);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to fetch server configuration');
    }
  };

  useEffect(() => {
    fetchEvolutionData();
    fetchStatus();
    fetchServerConfig();
  }, []);

  const handleUpdateConfig = async (partial: any) => {
    if (!serverConfig) return;
    
    // Optimistic update
    const updatedAutoEvolution = { ...serverConfig.autoEvolution, ...partial.autoEvolution };
    setServerConfig({ ...serverConfig, autoEvolution: updatedAutoEvolution });
    
    setIsSavingConfig(true);
    try {
      await serverApi.patch('/api/admin/config', partial);
      Logger.info('EvolutionView', 'Server configuration updated');
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to update server configuration');
      // Revert on error
      fetchServerConfig();
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleRunCycle = async () => {
    setIsTriggering(true);
    try {
      await serverApi.post('/api/evolution/cycle/run');
      Logger.info('EvolutionView', 'Evolution cycle triggered');
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to trigger cycle');
    } finally {
      setIsTriggering(false);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      await serverApi.post(`/api/evolution/proposals/${id}/${action}`);
      fetchEvolutionData();
    } catch (err) {
      Logger.error('EvolutionView', `Action ${action} failed for ${id}`);
    }
  };

  const handleAddPath = async () => {
    if (!newPath) return;
    try {
      await serverApi.post('/api/evolution/protected-paths', { path: newPath, reason: newReason });
      setNewPath('');
      setNewReason('');
      fetchEvolutionData();
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to add protected path');
    }
  };

  const handleDeletePath = async (path: string) => {
    try {
      await serverApi.delete(`/api/evolution/protected-paths/${encodeURIComponent(path)}`);
      fetchEvolutionData();
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to delete protected path');
    }
  };

  const handleDeleteCandidate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this neural insight?')) return;
    try {
      await serverApi.delete(`/api/evolution/candidates/${id}`);
      fetchEvolutionData();
      setSelectedCandidate(null);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to delete candidate');
    }
  };

  const handleDeleteProposal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this proposal? This will also attempt to close the Gitea PR.')) return;
    try {
      await serverApi.delete(`/api/evolution/proposals/${id}`);
      fetchEvolutionData();
      setSelectedProposal(null);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to delete proposal');
    }
  };
  const handleProcessCandidate = async (id: string) => {
    setIsProcessingSpecific(id);
    try {
      await serverApi.post(`/api/evolution/candidates/${id}/process`);
      Logger.info('EvolutionView', 'Candidate processing triggered');
      fetchEvolutionData();
      setSelectedCandidate(null);
    } catch (err) {
      Logger.error('EvolutionView', 'Failed to trigger candidate processing');
    } finally {
      setIsProcessingSpecific(null);
    }
  };

  const stats = [
    { label: 'Neural Insights', value: candidates.length, icon: Sparkles, color: 'text-primary', id: 'candidates' },
    { label: 'Active Proposals', value: proposals.filter(p => p.status === 'proposed').length, icon: GitPullRequest, color: 'text-warning', id: 'proposals' },
    { label: 'Merged Assets', value: proposals.filter(p => p.status === 'merged').length, icon: CheckCircle2, color: 'text-success', id: 'history' },
  ];

  return (
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-6">
          <div className="p-4 bg-primary/10 rounded-3xl border border-primary/20 shadow-2xl shadow-primary/10">
            <Cpu className="w-10 h-10 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-black tracking-tight italic">Auto-Evolution Engine</h2>
            <p className="text-sm text-muted-foreground font-medium uppercase tracking-[0.2em] opacity-60">Autonomous Architectural Growth & Self-Correction</p>
          </div>
        </div>
        
        <div className="flex gap-4">
          <button 
            onClick={handleRunCycle}
            disabled={isTriggering}
            className="flex items-center gap-3 px-8 py-4 bg-primary text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-primary-hover transition-all active:scale-95 shadow-xl shadow-primary/30 disabled:opacity-50"
          >
            <Play size={16} className={isTriggering ? 'animate-spin' : ''} />
            {isTriggering ? 'Running Cycle...' : 'Trigger Evolution Cycle'}
          </button>
        </div>
      </div>

      {/* SUMMARY STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map(stat => (
          <div 
            key={stat.label} 
            onClick={() => {
              const el = document.getElementById(stat.id);
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="glass-panel p-6 rounded-[32px] border border-white/5 flex items-center gap-6 group hover:border-primary/20 transition-all cursor-pointer"
          >
            <div className={`p-4 bg-background/50 rounded-2xl border border-white/5 ${stat.color} group-hover:scale-110 transition-transform`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">{stat.label}</p>
              <h4 className="text-2xl font-black italic">{stat.value}</h4>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: ACTIVE PROPOSALS */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div id="candidates" className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-black uppercase tracking-[0.3em] text-foreground/70 flex items-center gap-3">
              <Sparkles className="text-primary" size={16} /> Neural Insights
            </h3>
            <span className="bg-surface border border-border px-4 py-1.5 rounded-full text-[10px] font-black">{candidates.length} TOTAL</span>
          </div>

          {/* CANDIDATES QUEUE */}
          {candidates.length > 0 && (
              <div className="flex flex-col gap-3">
                {candidates.map(cand => (
                  <div 
                    key={cand.id} 
                    onClick={() => setSelectedCandidate(cand)}
                    className="p-5 bg-surface/40 border border-primary/10 rounded-2xl flex items-center justify-between gap-6 relative overflow-hidden group hover:border-primary/30 hover:bg-surface/60 transition-all cursor-pointer"
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${cand.severity >= 8 ? 'bg-error/20 text-error' : 'bg-primary/20 text-primary'}`}>
                                SEV {cand.severity}
                            </span>
                            <h5 className="text-sm font-black italic truncate">{cand.title}</h5>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">{cand.description}</p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                        <div className="flex flex-col items-end gap-1">
                            <div className="w-16 h-1 bg-background rounded-full overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${cand.confidence * 100}%` }}></div>
                            </div>
                            <span className="text-[8px] font-mono opacity-40">{(cand.confidence * 100).toFixed(0)}% CONF</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteCandidate(cand.id); }}
                                className="p-2 text-muted-foreground hover:text-error transition-colors"
                            >
                                <Trash2 size={14} />
                            </button>
                            <ExternalLink size={14} className="opacity-0 group-hover:opacity-40 transition-opacity" />
                        </div>
                    </div>
                  </div>
                ))}
              </div>
          )}

          <h3 id="proposals" className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/70 flex items-center gap-3 mb-4">
            <GitPullRequest className="text-primary" size={14} /> Open Proposals (Code Changes)
          </h3>

          {proposals.length === 0 ? (
            <div className="glass-panel p-16 rounded-[40px] flex flex-col items-center justify-center text-center gap-6 opacity-60 border-dashed border-2">
              <Terminal className="w-16 h-16 text-muted-foreground/30" />
              <p className="text-xs font-black uppercase tracking-[0.4em] max-w-xs">No pending evolution proposals detected in the neural buffer.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {proposals.map(prop => (
                <div 
                  key={prop.id} 
                  onClick={() => setSelectedProposal(prop)}
                  className="glass-panel rounded-[32px] p-8 border border-white/5 hover:border-primary/20 transition-all group relative overflow-hidden cursor-pointer"
                >
                  <div className={`absolute top-0 right-0 w-32 h-32 opacity-5 pointer-events-none transition-transform group-hover:scale-110 ${prop.status === 'merged' ? 'text-success' : 'text-primary'}`}>
                    {prop.status === 'merged' ? <CheckCircle2 className="w-full h-full" /> : <GitPullRequest className="w-full h-full" />}
                  </div>

                  <div className="flex flex-col gap-6 relative z-10">
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                          <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${prop.status === 'proposed' ? 'bg-primary/20 text-primary' : prop.status === 'merged' ? 'bg-success/20 text-success' : 'bg-error/20 text-error'}`}>
                            {prop.status}
                          </span>
                          <span className="text-[10px] font-mono opacity-40 uppercase">PR #{prop.pr_number}</span>
                        </div>
                        <h4 className="text-xl font-black italic tracking-tight group-hover:text-primary transition-colors">{prop.candidate_title}</h4>
                      </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDeleteProposal(prop.id); }}
                            className="p-3 bg-surface hover:bg-error/10 hover:text-error border border-border rounded-xl transition-all shadow-lg"
                          >
                            <Trash2 size={18} />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); openUrl(prop.pr_url); }}
                            className="p-3 bg-surface hover:bg-surface-hover border border-border rounded-xl transition-all shadow-lg hover:-translate-y-1"
                          >
                            <ExternalLink size={18} />
                          </button>
                        </div>
                    </div>

                    <div className="p-5 bg-background/50 rounded-2xl border border-white/5 text-sm text-muted-foreground leading-relaxed italic">
                      "{prop.explanation}"
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Target Component</span>
                        <span className="text-[11px] font-mono truncate">{prop.target_component}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Branch</span>
                        <span className="text-[11px] font-mono truncate">{prop.branch_name}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Impact</span>
                        <span className={`text-[11px] font-black uppercase ${prop.impact === 'high' ? 'text-error' : prop.impact === 'medium' ? 'text-warning' : 'text-success'}`}>
                          {prop.impact}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Breaking Change</span>
                        <span className="text-[11px] font-black uppercase">{prop.breaking_change ? '⚠️ YES' : 'NO'}</span>
                      </div>
                    </div>

                    {prop.status === 'proposed' && (
                      <div className="flex gap-4 pt-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleAction(prop.id, 'approve'); }}
                          className="flex-1 py-4 bg-success text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-success/80 transition-all shadow-lg shadow-success/20 flex items-center justify-center gap-3"
                        >
                          <CheckCircle2 size={16} /> Approve & Merge
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleAction(prop.id, 'reject'); }}
                          className="flex-1 py-4 bg-surface-hover border border-border text-foreground text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-error/10 hover:text-error hover:border-error/20 transition-all flex items-center justify-center gap-3"
                        >
                          <XCircle size={16} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: CONFIG & PROTECTION */}
        <div className="flex flex-col gap-10">
          
          {/* CONFIGURATION PANEL */}
          <div className="glass-panel p-8 rounded-[40px] flex flex-col gap-8 border-white/5">
            <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-primary flex items-center gap-4">
              <ShieldCheck size={18} /> Global Parameters
            </h3>

            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black uppercase tracking-widest opacity-60">Engine Status</span>
                  {isSavingConfig && <Activity size={12} className="text-primary animate-spin" />}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={serverConfig?.autoEvolution?.enabled || false} 
                    onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, enabled: e.target.checked } })}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-xs font-black uppercase tracking-widest opacity-60">Preferred Node</span>
                <Dropdown 
                  value={serverConfig?.autoEvolution?.preferredNode || 'AUTO'}
                  onChange={(val) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, preferredNode: val } })}
                  options={[
                    { label: 'AUTOMATIC ROUTING', value: 'AUTO' },
                    { 
                      label: 'CLOUD PROVIDERS', 
                      options: [
                        { label: 'GOOGLE GEMINI', value: 'GEMINI' },
                        { label: 'OPENROUTER', value: 'OPENROUTER' },
                        { label: 'FREELLMAPI', value: 'FREELLMAPI' }
                      ]
                    },
                    {
                      label: 'LOCAL NODES',
                      options: localNodes.map((n: any) => ({
                        label: `${n.id.toUpperCase()} (${n.type.toUpperCase()})`,
                        value: n.id
                      }))
                    }
                  ]}
                  className="w-full font-black text-xs"
                />
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-xs font-black uppercase tracking-widest opacity-60">Daily Proposal Limit</span>
                <input 
                  type="number"
                  value={serverConfig?.autoEvolution?.maxProposalsPerDay || 3}
                  onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, maxProposalsPerDay: parseInt(e.target.value) } })}
                  className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
                />
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-xs font-black uppercase tracking-widest opacity-60">Cron Expression</span>
                <input 
                  type="text"
                  value={serverConfig?.autoEvolution?.cronExpression || '0 3 * * *'}
                  onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, cronExpression: e.target.value } })}
                  className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-mono focus:border-primary/50 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-3">
                  <span className="text-xs font-black uppercase tracking-widest opacity-60">Min Severity</span>
                  <input 
                    type="number"
                    min="1"
                    max="10"
                    value={serverConfig?.autoEvolution?.minSeverityThreshold || 6}
                    onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, minSeverityThreshold: parseInt(e.target.value) } })}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <span className="text-xs font-black uppercase tracking-widest opacity-60">Min Confidence</span>
                  <input 
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={serverConfig?.autoEvolution?.minConfidenceThreshold || 0.65}
                    onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, minConfidenceThreshold: parseFloat(e.target.value) } })}
                    className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-xs font-black uppercase tracking-widest opacity-60">Validation Timeout (ms)</span>
                <input 
                  type="number"
                  value={serverConfig?.autoEvolution?.validationTimeoutMs || 60000}
                  onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, validationTimeoutMs: parseInt(e.target.value) } })}
                  className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-black focus:border-primary/50 outline-none"
                />
              </div>

              <div className="flex flex-col gap-3">
                 <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-widest opacity-60">Shadow Mode</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={serverConfig?.autoEvolution?.shadowMode || false} 
                        onChange={(e) => handleUpdateConfig({ autoEvolution: { ...serverConfig?.autoEvolution, shadowMode: e.target.checked } })}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                 </div>
                 <p className="text-[10px] text-muted-foreground italic">If enabled, the engine only validates code without pushing to Gitea.</p>
              </div>
            </div>
          </div>

          {/* PROTECTED PATHS PANEL */}
          <div className="glass-panel p-8 rounded-[40px] flex flex-col gap-8 border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-warning flex items-center gap-4">
                <Lock size={18} /> Protected Areas
              </h3>
              <AlertTriangle className="text-warning/40" size={16} />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <input 
                  placeholder="Path glob (e.g. src/db/**)"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  className="w-full bg-surface border border-border rounded-2xl p-4 text-xs font-mono focus:border-warning/50 outline-none"
                />
                <div className="flex gap-2">
                  <input 
                    placeholder="Reason..."
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    className="flex-1 bg-surface border border-border rounded-2xl p-4 text-xs italic focus:border-warning/50 outline-none"
                  />
                  <button 
                    onClick={handleAddPath}
                    className="p-4 bg-surface-hover border border-border rounded-2xl hover:bg-warning/20 hover:text-warning hover:border-warning/30 transition-all shadow-inner"
                  >
                    <Play size={16} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-4 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                {protectedPaths.map(p => (
                  <div key={p.path} className="p-4 bg-background/40 rounded-2xl border border-white/5 flex justify-between items-center group">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[11px] font-mono truncate">{p.path}</span>
                      {p.reason && <span className="text-[9px] italic opacity-40 truncate">{p.reason}</span>}
                    </div>
                    <button 
                      onClick={() => handleDeletePath(p.path)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-muted-foreground hover:text-error transition-all"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-warning/5 border border-warning/20 rounded-2xl">
                <p className="text-[10px] text-warning/70 leading-relaxed italic">
                  <span className="font-black">NOTE:</span> .noautoedit file is always checked and takes precedence over these runtime rules.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
      {/* CANDIDATE DETAIL MODAL */}
      {selectedCandidate && (
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
                        {selectedCandidate.source.replace('_', ' ')}
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
      )}
      {/* PROPOSAL DETAIL MODAL */}
      {selectedProposal && (
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
      )}
    </div>
  );
}
