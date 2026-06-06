import React, { useState, useEffect, useCallback } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { useOrganizationState } from '../hooks/useOrganizationState';
import { DiscoveryConfig, organizationApi } from '../services/organizationApi';
import { triggerHaptic } from '../services/native';

interface OrganizationViewProps {
  serverSettings: AIMindMeshServerSettings | undefined;
}

type TabType = 'directives' | 'ideas' | 'repos' | 'roles' | 'audit';

const OrganizationView: React.FC<OrganizationViewProps> = ({ serverSettings }) => {
  const {
    directives, ideas, roles, auditLogs, repositories, hrProposals, discoveryConfig,
    loading, error,
    createDirective, cancelDirective, discoverIdeas, createRepository, bootstrapCiCd, runValidation,
    analyzeRecruitment, materializeProposal, updateProposal, deleteProposal, reviewIdea, approveIdea, deleteIdea, updateIdea, clearSession, generateDirectivesFromIdea, transitionIdeaToDevelopment, refreshAll,
    createRole, archiveRole, updateRole,
    fetchDiscoveryConfig: _fetchDiscovery, updateDiscoveryConfig, triggerDiscovery,
  } = useOrganizationState();

  const [activeTab, setActiveTab] = useState<TabType>('directives');

  // Forms — Directives
  const [newDirTitle, setNewDirTitle] = useState('');
  const [newDirDesc, setNewDirDesc] = useState('');
  const [newDirGoal, setNewDirGoal] = useState<'explore' | 'build' | 'improve' | 'stop' | 'pivot' | 'research'>('build');
  const [newDirPriority, setNewDirPriority] = useState(50);
  const [selectedDirective, setSelectedDirective] = useState<any | null>(null);

  // Forms — Repos
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoNamespace, setNewRepoNamespace] = useState('aimindmesh-labs');
  const [newRepoTemplate, setNewRepoTemplate] = useState('node-webapp');

  // Forms — Ideas
  const [discoveryTopic, setDiscoveryTopic] = useState('');

  // Forms — Roles
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<any | null>(null);
  const [humanFeedbackText, setHumanFeedbackText] = useState('');
  const [editRoleForm, setEditRoleForm] = useState<any | null>(null);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({ name: '', description: '', mission: '', systemPrompt: '' });

  const [isEditingIdea, setIsEditingIdea] = useState(false);
  const [editIdeaTitle, setEditIdeaTitle] = useState('');
  const [editIdeaProblem, setEditIdeaProblem] = useState('');
  const [editIdeaSummary, setEditIdeaSummary] = useState('');

  // Forms — HR Proposals
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null);
  const [isEditingProposal, setIsEditingProposal] = useState(false);
  const [editPropName, setEditPropName] = useState('');
  const [editPropNeed, setEditPropNeed] = useState('');
  const [editPropMission, setEditPropMission] = useState('');
  const [editPropPrompt, setEditPropPrompt] = useState('');
  const [editPropPermissions, setEditPropPermissions] = useState<string[]>([]);

  // Discovery settings
  const [showDiscoverySettings, setShowDiscoverySettings] = useState(false);
  const [discoverySettings, setDiscoverySettings] = useState<Partial<DiscoveryConfig> | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const [selectedRepoForLogs, setSelectedRepoForLogs] = useState<any | null>(null);
  const [repoLogs, setRepoLogs] = useState<any[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);

  const fetchRepoLogs = useCallback(async (repoName: string) => {
    if (!serverSettings) return;
    setLoadingLogs(true);
    try {
      const res = await organizationApi.getSessionHistory(serverSettings, `develop-${repoName}`);
      setRepoLogs(res);
      const statusRes = await organizationApi.getSessionStatus(serverSettings, `develop-${repoName}`);
      setIsAgentActive(statusRes.active);
    } catch (e) {
      console.error('Failed to fetch evolution logs', e);
      setRepoLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [serverSettings]);

  useEffect(() => {
    if (!selectedRepoForLogs) {
      setRepoLogs(null);
      return;
    }
    fetchRepoLogs(selectedRepoForLogs.repo_name);
    const interval = setInterval(() => {
      fetchRepoLogs(selectedRepoForLogs.repo_name);
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedRepoForLogs, fetchRepoLogs]);

  const loadData = useCallback(async () => {
    if (!serverSettings?.enabled) return;
    try {
      await refreshAll(serverSettings);
    } catch (e) {
      console.error(e);
    }
  }, [serverSettings, refreshAll]);

  const handleReviewIdea = async (ideaId: string, feedback?: string) => {
    if (!serverSettings) return;
    const updated = await reviewIdea(serverSettings, ideaId, feedback);
    if (updated) {
      setSelectedIdea(updated);
    }
  };

  useEffect(() => {
    if (selectedIdea) {
      setHumanFeedbackText(selectedIdea.humanFeedback || '');
    } else {
      setHumanFeedbackText('');
    }
  }, [selectedIdea]);

  const handleSaveIdea = async () => {
    if (!serverSettings || !selectedIdea) return;
    try {
      await updateIdea(serverSettings, selectedIdea.id, {
        title: editIdeaTitle,
        problemStatement: editIdeaProblem,
        summary: editIdeaSummary,
      });
      setSelectedIdea({
        ...selectedIdea,
        title: editIdeaTitle,
        problemStatement: editIdeaProblem,
        summary: editIdeaSummary,
      });
      setIsEditingIdea(false);
    } catch (e) {
      console.error('Failed to save idea details', e);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (discoveryConfig && !discoverySettings) {
      setDiscoverySettings({ ...discoveryConfig });
    }
  }, [discoveryConfig, discoverySettings]);

  if (!serverSettings?.enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-background">
        <span className="text-5xl">🏛️</span>
        <h2 className="text-xl font-bold mt-4">Organization Control Offline</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-xs leading-relaxed">
          Enable and configure the AIMindMesh Server Settings to access the strategic room.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative select-none">
      {/* HEADER */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">AI Council</h1>
          <p className="text-xs text-text-secondary mt-0.5">Mobile operator governance board</p>
        </div>
        <button onClick={loadData} disabled={loading} className="p-2 rounded-xl bg-surface/80 border border-white/10">
          <svg className={`w-4 h-4 text-text-secondary ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {error && <div className="mx-5 mb-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{error}</div>}

      {/* TABS */}
      <div className="flex gap-2 px-5 py-2 shrink-0 overflow-x-auto custom-scrollbar">
        {(['directives', 'ideas', 'repos', 'roles', 'audit'] as TabType[]).map(tab => (
          <button
            key={tab}
            onClick={() => { triggerHaptic('LIGHT'); setActiveTab(tab); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border shrink-0 ${
              activeTab === tab ? 'bg-blue-500 text-white border-blue-500 shadow-lg shadow-blue-500/15' : 'bg-surface/50 text-text-secondary border-white/5'
            }`}
          >
            {tab === 'directives' && '🎯 Directives'}
            {tab === 'ideas' && '💡 Ideas'}
            {tab === 'repos' && '📂 Repos'}
            {tab === 'roles' && '👥 Roles & HR'}
            {tab === 'audit' && '📝 Logs'}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto px-5 pb-24 pt-3">
        {/* DIRECTIVES */}
        {activeTab === 'directives' && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/5 bg-surface/30 p-5 space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">New Directive</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await createDirective(serverSettings, { title: newDirTitle, description: newDirDesc, goalType: newDirGoal, priority: Number(newDirPriority), constraints: { avoidCloudDependencies: true } });
                setNewDirTitle(''); setNewDirDesc('');
              }} className="space-y-3">
                <input type="text" required value={newDirTitle} onChange={e => setNewDirTitle(e.target.value)} placeholder="Title..." className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                <textarea required rows={2} value={newDirDesc} onChange={e => setNewDirDesc(e.target.value)} placeholder="Description..." className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                <div className="grid grid-cols-2 gap-3">
                  <select value={newDirGoal} onChange={e => setNewDirGoal(e.target.value as any)} className="bg-input border border-white/10 rounded-2xl px-3 py-2.5 text-xs text-text-primary">
                    {['explore', 'build', 'improve', 'stop', 'pivot', 'research'].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <input type="number" required min={1} max={100} value={newDirPriority} onChange={e => setNewDirPriority(Number(e.target.value))} className="bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                </div>
                <button type="submit" className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider">Deploy Goal</button>
              </form>
            </div>
            <div className="space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Active Directives ({directives.length})</h3>
              {directives.map(dir => (
                <div key={dir.id} className="rounded-3xl border border-white/5 bg-surface/40 p-5 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-blue-500/10 text-blue-400">{dir.goalType}</span>
                    <span className="text-[10px] text-text-secondary">Priority: {dir.priority}</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-text-primary text-sm">{dir.title}</h4>
                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">{dir.description}</p>
                  </div>
                  <button
                    onClick={() => setSelectedDirective(dir)}
                    className="w-full mt-1 bg-surface/50 border border-white/5 text-text-secondary py-1.5 rounded-2xl text-xs font-bold uppercase"
                  >
                    View Details
                  </button>
                  <button onClick={() => cancelDirective(serverSettings, dir.id)} className="w-full bg-red-500/10 border border-red-500/20 text-red-400 py-2 rounded-2xl text-xs font-bold uppercase">Cancel Goal</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IDEAS */}
        {activeTab === 'ideas' && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/5 bg-surface/30 p-5 space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Venture Discovery</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await discoverIdeas(serverSettings, discoveryTopic);
                setDiscoveryTopic('');
              }} className="space-y-3">
                <input type="text" required value={discoveryTopic} onChange={e => setDiscoveryTopic(e.target.value)} placeholder="Topic..." className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                <button type="submit" className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider">Explore</button>
              </form>

              {/* AUTONOMOUS DISCOVERY */}
              <div className="pt-3 border-t border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-text-primary">🤖 Autonomous</p>
                    {discoveryConfig && (
                      <p className="text-[10px] text-text-secondary mt-0.5">
                        {discoveryConfig.isRunning ? '⏳ Running...' : discoveryConfig.lastRunAt ? `Last: ${new Date(discoveryConfig.lastRunAt).toLocaleString()}` : 'Never run'}
                        {' · '}<span className={discoveryConfig.enabled ? 'text-emerald-400' : 'text-red-400'}>{discoveryConfig.enabled ? 'ON' : 'OFF'}</span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await triggerDiscovery(serverSettings);
                        setTriggerResult(res.ideasFound > 0 ? `✅ ${res.ideasFound} new idea(s)` : '✅ Done');
                        await refreshAll(serverSettings);
                        setTimeout(() => setTriggerResult(null), 4000);
                      } catch { /* error already set */ }
                    }}
                    disabled={loading}
                    className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-[10px] font-bold uppercase"
                  >
                    ▶ Run Now
                  </button>
                </div>

                {triggerResult && (
                  <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-[10px] text-emerald-400 font-semibold">{triggerResult}</div>
                )}

                <button
                  onClick={() => {
                    setShowDiscoverySettings(!showDiscoverySettings);
                    if (!discoverySettings && discoveryConfig) setDiscoverySettings({ ...discoveryConfig });
                  }}
                  className="text-[10px] text-text-secondary font-bold uppercase tracking-wider"
                >
                  {showDiscoverySettings ? '▲ Hide Settings' : '⚙ Settings'}
                </button>

                {showDiscoverySettings && discoverySettings && (
                  <div className="space-y-4 p-4 bg-black/20 border border-white/5 rounded-2xl">
                    <label className="flex items-center gap-3 text-xs text-text-primary cursor-pointer">
                      <input type="checkbox" checked={discoverySettings.enabled ?? true} onChange={e => setDiscoverySettings({ ...discoverySettings, enabled: e.target.checked })} className="accent-blue-500 w-4 h-4" />
                      Enabled
                    </label>

                    <div>
                      <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Cron Expression</label>
                      <input type="text" value={discoverySettings.cronExpression || ''} onChange={e => setDiscoverySettings({ ...discoverySettings, cronExpression: e.target.value })} className="w-full bg-input border border-white/10 rounded-xl px-3 py-2 text-xs text-text-primary font-mono" placeholder="0 */12 * * *" />
                    </div>

                    <div>
                      <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Max Topics / Cycle: {discoverySettings.maxTopicsPerCycle ?? 3}</label>
                      <input type="range" min={1} max={10} value={discoverySettings.maxTopicsPerCycle ?? 3} onChange={e => setDiscoverySettings({ ...discoverySettings, maxTopicsPerCycle: Number(e.target.value) })} className="w-full accent-blue-500" />
                    </div>

                    <div>
                      <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Min Score: {discoverySettings.minScoreThreshold ?? 0.55}</label>
                      <input type="range" min={0} max={1} step={0.05} value={discoverySettings.minScoreThreshold ?? 0.55} onChange={e => setDiscoverySettings({ ...discoverySettings, minScoreThreshold: Number(e.target.value) })} className="w-full accent-blue-500" />
                    </div>

                    <label className="flex items-center gap-3 text-xs text-text-primary cursor-pointer">
                      <input type="checkbox" checked={discoverySettings.autoCouncil ?? false} onChange={e => setDiscoverySettings({ ...discoverySettings, autoCouncil: e.target.checked })} className="accent-blue-500 w-4 h-4" />
                      Auto Council
                    </label>

                    {discoverySettings.autoCouncil && (
                      <div>
                        <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Auto Council Score: {discoverySettings.minAutoCouncilScore ?? 0.75}</label>
                        <input type="range" min={0} max={1} step={0.05} value={discoverySettings.minAutoCouncilScore ?? 0.75} onChange={e => setDiscoverySettings({ ...discoverySettings, minAutoCouncilScore: Number(e.target.value) })} className="w-full accent-blue-500" />
                      </div>
                    )}

                    <button
                      onClick={async () => {
                        try {
                          await updateDiscoveryConfig(serverSettings, discoverySettings);
                          setShowDiscoverySettings(false);
                        } catch { /* error set in hook */ }
                      }}
                      className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider"
                    >
                      Save Settings
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Discovered Ideas</h3>
              {ideas.map(idea => (
                <div key={idea.id} onClick={() => { triggerHaptic('LIGHT'); setSelectedIdea(idea); }} className="rounded-3xl border border-white/5 bg-surface/40 p-5 flex flex-col gap-3 active:scale-[0.98] transition-all">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-text-primary text-sm">{idea.title}</h4>
                      <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block ${
                        idea.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        idea.status === 'rejected' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        idea.status === 'reviewing' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      }`}>{idea.status}</span>
                    </div>
                    <span className="text-lg font-black text-blue-400">{(idea.overallScore * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{idea.problemStatement}</p>
                  {(idea.status === 'approved' || idea.status === 'rejected') && (
                    <div className="text-[10px] text-blue-400 font-bold flex items-center gap-1.5 bg-blue-500/5 p-2.5 rounded-2xl border border-blue-500/10">
                      <span>📄 Click to view Council Debate Synthesis results</span>
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={(e) => { e.stopPropagation(); triggerHaptic('LIGHT'); handleReviewIdea(idea.id); }} className="flex-1 bg-blue-500 text-white py-2 rounded-2xl text-xs font-bold uppercase">Debate Council</button>
                    <button onClick={(e) => { e.stopPropagation(); triggerHaptic('LIGHT'); if (serverSettings) approveIdea(serverSettings, idea.id); }} className="flex-1 bg-surface/50 border border-white/10 text-text-secondary py-2 rounded-2xl text-xs font-bold uppercase">Approve</button>
                    <button onClick={(e) => { e.stopPropagation(); triggerHaptic('LIGHT'); if (serverSettings) deleteIdea(serverSettings, idea.id); }} className="px-3 bg-red-950/40 border border-red-500/30 text-red-400 py-2 rounded-2xl text-xs font-bold uppercase">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REPOS */}
        {activeTab === 'repos' && (
          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/5 bg-surface/30 p-5 space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Provision Repo</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await createRepository(serverSettings, { repoName: newRepoName, namespace: newRepoNamespace, bootstrapTemplate: newRepoTemplate, enableCiCd: true, visibility: 'private' });
                setNewRepoName('');
              }} className="space-y-3">
                <input type="text" required value={newRepoName} onChange={e => setNewRepoName(e.target.value)} placeholder="Repo Name..." className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                <input type="text" required value={newRepoNamespace} onChange={e => setNewRepoNamespace(e.target.value)} placeholder="Namespace..." className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
                <select value={newRepoTemplate} onChange={e => setNewRepoTemplate(e.target.value)} className="w-full bg-input border border-white/10 rounded-2xl px-3 py-2.5 text-xs text-text-primary">
                  {['node-webapp', 'node-library', 'docker-service', 'tauri-desktop-app', 'static-site'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="submit" className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider">Create Repository</button>
              </form>
            </div>
            <div className="space-y-4">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Active Repositories</h3>
              {repositories.map(repo => (
                <div key={repo.id} className="rounded-3xl border border-white/5 bg-surface/40 p-5 flex flex-col gap-3">
                  <div>
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-text-primary text-sm">{repo.namespace}/{repo.repo_name}</h4>
                      {(() => {
                        const vs = repo.validation_status;
                        const lastTrig = repo.agent_last_triggered_at;
                        const staleMs = 90 * 60 * 1000;
                        const isStale = lastTrig && (Date.now() - new Date(lastTrig).getTime() > staleMs);

                        if (vs === 'evolving') {
                          return isStale
                            ? <span className="bg-amber-500/10 text-amber-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border border-amber-500/20">⚠ Stalled</span>
                            : <span className="bg-blue-500/10 text-blue-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">⚡ Evolving</span>;
                        }
                        if (vs === 'healthy') return <span className="bg-emerald-500/10 text-emerald-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border border-emerald-500/20">✓ Built</span>;
                        if (vs === 'broken') return <span className="bg-red-500/10 text-red-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border border-red-500/20">✗ Failed</span>;
                        if (vs === 'needs_verification') return <span className="bg-purple-500/10 text-purple-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border border-purple-500/20">↻ Verifying</span>;
                        return null;
                      })()}
                    </div>
                    <span className="text-[10px] text-text-secondary">{repo.gitea_url}</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => bootstrapCiCd(serverSettings, repo.id)} className="flex-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 py-2 rounded-2xl text-xs font-bold uppercase">Bootstrap CI</button>
                    <button onClick={() => runValidation(serverSettings, repo.id)} className="flex-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 py-2 rounded-2xl text-xs font-bold uppercase">Validate Kasm</button>
                    <button onClick={() => { triggerHaptic('LIGHT'); setSelectedRepoForLogs(repo); }} className="flex-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 py-2 rounded-2xl text-xs font-bold uppercase">Evolution Stream</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ROLES & HR */}
        {activeTab === 'roles' && (
          <div className="flex flex-col gap-6">
            {/* Roles List */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">AI Registry Roles</h3>
                <button
                  onClick={() => { triggerHaptic('LIGHT'); setShowCreateRole(true); setNewRoleForm({ name: '', description: '', mission: '', systemPrompt: '' }); }}
                  className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-xl text-xs font-bold uppercase"
                >
                  + New
                </button>
              </div>
              {roles.map(role => (
                <div key={role.id} className="rounded-3xl border border-white/5 bg-surface/40 p-5 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-text-primary text-sm">{role.name}</h4>
                      <p className="text-[10px] text-text-secondary uppercase">{role.mission}</p>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${role.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>{role.status}</span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{role.description}</p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => { triggerHaptic('LIGHT'); setSelectedRole(role); setEditRoleForm({ name: role.name, description: role.description, mission: role.mission, systemPrompt: role.systemPrompt }); }}
                      className="flex-1 bg-surface/50 border border-white/10 text-text-secondary py-2 rounded-2xl text-xs font-bold uppercase"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => archiveRole(serverSettings, role.id)}
                      className="flex-1 bg-red-500/10 border border-red-500/20 text-red-400 py-2 rounded-2xl text-xs font-bold uppercase"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* HR Proposals */}
            <div className="rounded-3xl border border-white/5 bg-surface/30 p-5 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">HR proposals</h3>
                <button onClick={() => analyzeRecruitment(serverSettings)} className="px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-xl text-xs font-bold uppercase">Analyze</button>
              </div>
              {hrProposals.map(prop => (
                <div key={prop.id} className="rounded-2xl border border-white/5 bg-surface/50 p-4 space-y-3">
                  <div>
                    <h4 className="font-bold text-text-primary text-xs">{prop.candidate_role_name}</h4>
                    <p className="text-[10px] text-text-secondary mt-0.5">{prop.business_need}</p>
                  </div>
                  {prop.status === 'proposed' ? (
                    <div className="flex gap-2">
                      <button onClick={() => materializeProposal(serverSettings, prop.id)} className="flex-1 bg-emerald-500 text-white py-2 rounded-xl text-xs font-bold uppercase">Materialize</button>
                      <button
                        onClick={() => {
                          triggerHaptic('LIGHT');
                          setSelectedProposal(prop);
                          setEditPropName(prop.candidate_role_name);
                          setEditPropNeed(prop.business_need);
                          setEditPropMission(prop.suggested_mission);
                          setEditPropPrompt(prop.suggested_prompt);
                          try {
                            setEditPropPermissions(JSON.parse(prop.required_permissions || '[]'));
                          } catch {
                            setEditPropPermissions([]);
                          }
                          setIsEditingProposal(true);
                        }}
                        className="px-3 bg-surface/50 border border-white/10 text-text-secondary py-2 rounded-xl text-xs font-bold uppercase"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteProposal(serverSettings, prop.id)} className="px-3 bg-red-950/40 border border-red-500/30 text-red-400 py-2 rounded-xl text-xs font-bold uppercase">Delete</button>
                    </div>
                  ) : (
                    <span className="block text-center text-xs bg-surface text-text-secondary py-2 rounded-xl font-bold uppercase">{prop.status}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Recent Executions</h3>
            {auditLogs.map(log => (
              <div key={log.id} className="rounded-3xl border border-white/5 bg-surface/40 p-4 space-y-2">
                <div className="flex justify-between items-center text-[10px] text-text-secondary">
                  <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-mono uppercase text-[9px]">{log.event_type}</span>
                </div>
                <div className="text-xs text-text-primary font-semibold">{log.actor_type}:{log.actor_id}</div>
                <div className="text-[10px] text-text-secondary font-mono bg-black/25 p-2 rounded-lg truncate">{log.payload}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DIRECTIVE DETAIL BOTTOM SHEET */}
      {selectedDirective && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => setSelectedDirective(null)}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Directive Detail</h3>
              <button onClick={() => setSelectedDirective(null)} className="text-text-secondary text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <span className="text-[9px] text-text-secondary uppercase font-bold">Title</span>
                <p className="text-sm font-bold text-text-primary mt-0.5">{selectedDirective.title}</p>
              </div>
              <div>
                <span className="text-[9px] text-text-secondary uppercase font-bold">Goal Type</span>
                <p className="text-xs text-blue-400 font-bold mt-0.5 uppercase">{selectedDirective.goalType}</p>
              </div>
              <div>
                <span className="text-[9px] text-text-secondary uppercase font-bold">Priority</span>
                <p className="text-xs text-text-primary mt-0.5">{selectedDirective.priority}</p>
              </div>
              <div>
                <span className="text-[9px] text-text-secondary uppercase font-bold">Description</span>
                <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{selectedDirective.description}</p>
              </div>
              {selectedDirective.constraints && Object.keys(selectedDirective.constraints).length > 0 && (
                <div>
                  <span className="text-[9px] text-text-secondary uppercase font-bold">Constraints</span>
                  <pre className="text-[10px] text-text-secondary mt-0.5 font-mono bg-black/25 p-2 rounded-xl overflow-x-auto">{JSON.stringify(selectedDirective.constraints, null, 2)}</pre>
                </div>
              )}
              <div>
                <span className="text-[9px] text-text-secondary uppercase font-bold">Created</span>
                <p className="text-[10px] text-text-secondary mt-0.5">{new Date(selectedDirective.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IDEA DETAIL BOTTOM SHEET */}
      {selectedIdea && (
        <div className="fixed inset-0 bg-black/77 backdrop-blur-sm z-40 flex items-end" onClick={() => { setSelectedIdea(null); setIsEditingIdea(false); }}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div>
                <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Venture Idea Detail</h3>
                <p className="text-[9px] text-text-secondary">ID: {selectedIdea.id}</p>
              </div>
              <button onClick={() => { setSelectedIdea(null); setIsEditingIdea(false); }} className="text-text-secondary text-lg">✕</button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-black/20 p-4 rounded-2xl border border-white/5">
                <div>
                  <span className="text-[9px] text-text-secondary uppercase font-bold">Status</span>
                  <span className="block mt-0.5 text-xs font-bold text-amber-400 uppercase">{selectedIdea.status}</span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-text-secondary uppercase font-bold">Overall Score</span>
                  <span className="block mt-0.5 text-base font-black text-blue-400">{(selectedIdea.overallScore * 100).toFixed(0)}%</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="bg-black/10 p-2.5 rounded-2xl border border-white/5">
                  <span className="block text-[9px] text-text-secondary uppercase font-bold">Strategic</span>
                  <span className="text-xs font-bold text-text-primary">{selectedIdea.strategicScore}</span>
                </div>
                <div className="bg-black/10 p-2.5 rounded-2xl border border-white/5">
                  <span className="block text-[9px] text-text-secondary uppercase font-bold">Feasibility</span>
                  <span className="text-xs font-bold text-text-primary">{selectedIdea.feasibilityScore}</span>
                </div>
                <div className="bg-black/10 p-2.5 rounded-2xl border border-white/5">
                  <span className="block text-[9px] text-text-secondary uppercase font-bold">Novelty</span>
                  <span className="text-xs font-bold text-text-primary">{selectedIdea.noveltyScore}</span>
                </div>
              </div>

              {isEditingIdea ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[9px] text-text-secondary uppercase font-bold mb-1">Title</label>
                    <input
                      type="text"
                      value={editIdeaTitle}
                      onChange={(e) => setEditIdeaTitle(e.target.value)}
                      className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-text-secondary uppercase font-bold mb-1">Problem Statement</label>
                    <textarea
                      value={editIdeaProblem}
                      onChange={(e) => setEditIdeaProblem(e.target.value)}
                      rows={4}
                      className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-blue-500 resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-text-secondary uppercase font-bold mb-1">Summary</label>
                    <textarea
                      value={editIdeaSummary}
                      onChange={(e) => setEditIdeaSummary(e.target.value)}
                      rows={4}
                      className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-blue-500 resize-y"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveIdea}
                      disabled={loading}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider transition-all"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setIsEditingIdea(false)}
                      className="px-5 bg-black/40 hover:bg-black/60 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-[9px] text-text-secondary uppercase font-bold">Title</span>
                    <p className="text-xs font-bold text-text-primary mt-0.5">{selectedIdea.title}</p>
                  </div>

                  <div>
                    <span className="text-[9px] text-text-secondary uppercase font-bold">Problem Statement</span>
                    <p className="text-xs text-text-secondary mt-0.5 leading-relaxed whitespace-pre-wrap">{selectedIdea.problemStatement || 'N/A'}</p>
                  </div>

                  <div>
                    <span className="text-[9px] text-text-secondary uppercase font-bold">Summary</span>
                    <p className="text-xs text-text-secondary mt-0.5 leading-relaxed whitespace-pre-wrap">{selectedIdea.summary || 'N/A'}</p>
                  </div>

                  {selectedIdea.status === 'proposed' && (
                    <button
                      onClick={() => {
                        triggerHaptic('LIGHT');
                        setEditIdeaTitle(selectedIdea.title);
                        setEditIdeaProblem(selectedIdea.problemStatement || '');
                        setEditIdeaSummary(selectedIdea.summary || '');
                        setIsEditingIdea(true);
                      }}
                      className="w-full bg-black/35 border border-white/10 text-text-primary font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider transition-all"
                    >
                      ✏️ Edit Proposal
                    </button>
                  )}
                </div>
              )}

              <div className="bg-black/25 p-4 rounded-2xl border border-white/10 mt-2 space-y-3">
                <span className="text-[9px] text-text-secondary uppercase font-bold block">Intervene / Integrate Human Feedback</span>
                <textarea
                  value={humanFeedbackText}
                  onChange={(e) => setHumanFeedbackText(e.target.value)}
                  placeholder="Enter suggestions, constraints, or new directions to guide the Council's debate..."
                  rows={3}
                  className="w-full bg-input border border-white/10 rounded-xl px-3 py-2 text-xs text-text-primary resize-none focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    triggerHaptic('LIGHT');
                    await handleReviewIdea(selectedIdea.id, humanFeedbackText);
                  }}
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                >
                  {loading ? '⚙️ Running Debate...' : '💬 Integrate & Re-Debate'}
                </button>
              </div>

              {selectedIdea.analysisSynthesis && (
                <div className="bg-black/20 p-4 rounded-2xl border border-blue-500/20 mt-2 space-y-3">
                  <div>
                    <span className="text-[9px] text-blue-400 uppercase font-bold mb-1 block">🤖 Council Debate Synthesis</span>
                    <p className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap">{selectedIdea.analysisSynthesis}</p>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      triggerHaptic('LIGHT');
                      if (serverSettings) {
                        try {
                          await generateDirectivesFromIdea(serverSettings, selectedIdea.id);
                          setSelectedIdea(null);
                        } catch (err) {
                          console.error(err);
                        }
                      }
                    }}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2 rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                  >
                    {loading ? '⚙️ Processing...' : '⚙️ Generate Directives'}
                  </button>
                  {selectedIdea.status === 'approved' && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        triggerHaptic('LIGHT');
                        if (serverSettings) {
                          try {
                            await transitionIdeaToDevelopment(serverSettings, selectedIdea.id);
                            setSelectedIdea(null);
                          } catch (err) {
                            console.error(err);
                          }
                        }
                      }}
                      disabled={loading}
                      className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold py-2 rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                    >
                      {loading ? '🚀 Transitioning...' : '🚀 Transition to Development'}
                    </button>
                  )}
                </div>
              )}

              {selectedIdea.sourceSignals && selectedIdea.sourceSignals.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-secondary uppercase font-bold mb-1 block">Source Signals</span>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {selectedIdea.sourceSignals.map((sig: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-black/20 border border-white/5 rounded-xl text-[9px] text-text-secondary">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-[9px] text-text-secondary pt-2 border-t border-white/5">
                <div>Created: <strong>{new Date(selectedIdea.createdAt).toLocaleString()}</strong></div>
                <div>Updated: <strong>{new Date(selectedIdea.updatedAt).toLocaleString()}</strong></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROLE EDIT BOTTOM SHEET */}
      {selectedRole && editRoleForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => { setSelectedRole(null); setEditRoleForm(null); }}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Edit Role</h3>
              <button onClick={() => { setSelectedRole(null); setEditRoleForm(null); }} className="text-text-secondary text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Name</label>
                <input type="text" value={editRoleForm.name} onChange={e => setEditRoleForm({ ...editRoleForm, name: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Mission</label>
                <input type="text" value={editRoleForm.mission} onChange={e => setEditRoleForm({ ...editRoleForm, mission: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Description</label>
                <textarea rows={3} value={editRoleForm.description} onChange={e => setEditRoleForm({ ...editRoleForm, description: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">System Prompt</label>
                <textarea rows={4} value={editRoleForm.systemPrompt} onChange={e => setEditRoleForm({ ...editRoleForm, systemPrompt: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <button
                onClick={async () => {
                  try {
                    await updateRole(serverSettings, selectedRole.id, editRoleForm);
                    setSelectedRole(null);
                    setEditRoleForm(null);
                  } catch { /* error shown in view */ }
                }}
                className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE ROLE BOTTOM SHEET */}
      {showCreateRole && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => setShowCreateRole(false)}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">New Role</h3>
              <button onClick={() => setShowCreateRole(false)} className="text-text-secondary text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Name</label>
                <input type="text" value={newRoleForm.name} onChange={e => setNewRoleForm({ ...newRoleForm, name: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Mission</label>
                <input type="text" value={newRoleForm.mission} onChange={e => setNewRoleForm({ ...newRoleForm, mission: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Description</label>
                <textarea rows={3} value={newRoleForm.description} onChange={e => setNewRoleForm({ ...newRoleForm, description: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">System Prompt</label>
                <textarea rows={4} value={newRoleForm.systemPrompt} onChange={e => setNewRoleForm({ ...newRoleForm, systemPrompt: e.target.value })} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <button
                onClick={async () => {
                  if (!newRoleForm.name) return;
                  try {
                    await createRole(serverSettings, {
                      name: newRoleForm.name,
                      description: newRoleForm.description,
                      mission: newRoleForm.mission,
                      systemPrompt: newRoleForm.systemPrompt,
                      toolPermissions: ['web:search'],
                      canRecruit: false,
                      canProposeRepo: true,
                      canProvisionValidation: true,
                    });
                    setShowCreateRole(false);
                  } catch { /* error shown in view */ }
                }}
                className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider"
              >
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EVOLUTION LOGS BOTTOM SHEET */}
      {selectedRepoForLogs && (
        <div className="fixed inset-0 bg-black/77 backdrop-blur-sm z-40 flex items-end" onClick={() => { setSelectedRepoForLogs(null); setRepoLogs(null); }}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-white/5 pb-3 shrink-0">
              <div>
                <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider flex items-center gap-1.5">
                  <span>🧬</span> Evolution Stream
                </h3>
                <p className="text-[9px] text-text-secondary font-mono flex items-center gap-1.5">
                  <span>develop-{selectedRepoForLogs.repo_name}</span>
                  {isAgentActive ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[7px] font-bold rounded-full uppercase tracking-wider animate-pulse">
                      <span className="w-1 h-1 bg-emerald-500 rounded-full animate-ping"></span>
                      Working
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-white/5 text-text-secondary text-[7px] font-bold rounded-full uppercase tracking-wider">
                      Idle
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {loadingLogs && <span className="text-[9px] text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded-full animate-pulse">Streaming...</span>}
                <button
                  onClick={async () => {
                    if (window.confirm("Clear this session's history and restart from scratch?")) {
                      try {
                        triggerHaptic('MEDIUM');
                        if (serverSettings) {
                          await clearSession(serverSettings, `develop-${selectedRepoForLogs.repo_name}`);
                          setRepoLogs([]);
                        }
                      } catch (err: any) {
                        console.error(err);
                      }
                    }
                  }}
                  className="px-2 py-1 text-[9px] bg-red-950 hover:bg-red-900 border border-red-500/20 text-red-200 rounded-xl font-bold uppercase transition-all"
                >
                  Reset
                </button>
                <button onClick={() => { setSelectedRepoForLogs(null); setRepoLogs(null); }} className="text-text-secondary text-lg">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-black/20 p-4 rounded-2xl border border-white/5 font-mono text-[11px] text-text-secondary space-y-3 min-h-[300px]">
              {repoLogs === null ? (
                <div className="text-center py-12 text-text-secondary">Loading evolution trace...</div>
              ) : repoLogs.length === 0 ? (
                <div className="text-center py-12 text-text-secondary">No evolution logs yet. The agent may still be initializing or starting Gitea workspace.</div>
              ) : (
                repoLogs.map((msg: any, idx: number) => {
                  const isThought = msg.role === 'thought' || (msg.content && msg.content.includes('Thought:'));
                  return (
                    <div key={idx} className={`p-3 rounded-2xl border ${
                      msg.role === 'user' ? 'bg-blue-500/10 border-blue-500/15 text-blue-300' :
                      isThought ? 'bg-amber-500/10 border-amber-500/10 text-amber-400/90 italic' :
                      'bg-surface border-white/5 text-text-primary'
                    }`}>
                      <div className="text-[8px] uppercase font-bold opacity-60 mb-1">
                        {msg.role === 'user' ? 'SYSTEM INPUT' : isThought ? 'AGENT THOUGHT' : 'DEVELOPER AGENT'}
                      </div>
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* PROPOSAL EDIT BOTTOM SHEET */}
      {selectedProposal && isEditingProposal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-end" onClick={() => { setSelectedProposal(null); setIsEditingProposal(false); }}>
          <div className="w-full bg-surface rounded-t-3xl p-6 space-y-4 border-t border-white/10 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Edit HR Proposal</h3>
              <button onClick={() => { setSelectedProposal(null); setIsEditingProposal(false); }} className="text-text-secondary text-lg">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Candidate Role Name</label>
                <input type="text" value={editPropName} onChange={e => setEditPropName(e.target.value)} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Business Need</label>
                <textarea rows={2} value={editPropNeed} onChange={e => setEditPropNeed(e.target.value)} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Suggested Mission</label>
                <input type="text" value={editPropMission} onChange={e => setEditPropMission(e.target.value)} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <div>
                <label className="block text-[10px] text-text-secondary uppercase font-bold mb-1">Suggested Prompt</label>
                <textarea rows={4} value={editPropPrompt} onChange={e => setEditPropPrompt(e.target.value)} className="w-full bg-input border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-text-primary" />
              </div>
              <button
                onClick={async () => {
                  try {
                    await updateProposal(serverSettings, selectedProposal.id, {
                      candidateRoleName: editPropName,
                      businessNeed: editPropNeed,
                      suggestedMission: editPropMission,
                      suggestedPrompt: editPropPrompt,
                      requiredPermissions: editPropPermissions
                    });
                    setSelectedProposal(null);
                    setIsEditingProposal(false);
                  } catch { /* error shown in view */ }
                }}
                className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationView;
