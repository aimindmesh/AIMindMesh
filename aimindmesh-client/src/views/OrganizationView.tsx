import { useEffect, useState } from 'react';
import { useOrganizationStore } from '../store/organizationStore';

type TabType = 'directives' | 'roles' | 'ideas' | 'repos' | 'audit';

export default function OrganizationView() {
  const {
    roles, directives, ideas, auditLogs, repositories, hrProposals, loading, error,
    fetchRoles, fetchDirectives, fetchIdeas, fetchAuditLogs, fetchRepositories, fetchHRProposals,
    createRole, updateRole, archiveRole, createDirective, cancelDirective, discoverIdeas, reviewIdea, approveIdea, deleteIdea, generateDirectivesFromIdea, transitionIdeaToDevelopment,
    createRepository, bootstrapCiCd, runValidation, analyzeRecruitment, materializeProposal, updateProposal, deleteProposal,
    discoveryConfig, fetchDiscoveryConfig, updateDiscoveryConfig, triggerDiscovery,
    updateIdea
  } = useOrganizationStore();

  const [activeTab, setActiveTab] = useState<TabType>('directives');

  // Forms
  const [newDir, setNewDir] = useState({ title: '', description: '', goalType: 'build', priority: 50, constraints: '{"avoidCloudDependencies": true}' });
  const [newRole, setNewRole] = useState({ name: '', description: '', mission: '', systemPrompt: '', toolPermissions: ['web:search'], canRecruit: false, canProposeRepo: true, canProvisionValidation: true });
  const [newRepo, setNewRepo] = useState({ namespace: 'aimindmesh-labs', repoName: '', description: '', visibility: 'private', bootstrapTemplate: 'node-webapp', enableCiCd: true });
  const [discoveryTopic, setDiscoveryTopic] = useState('');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<any | null>(null);
  const [selectedDirective, setSelectedDirective] = useState<any | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<any | null>(null);
  const [humanFeedbackText, setHumanFeedbackText] = useState('');
  const [editRoleForm, setEditRoleForm] = useState<any | null>(null);
  const [showDiscoverySettings, setShowDiscoverySettings] = useState(false);
  const [discoverySettings, setDiscoverySettings] = useState<any>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [editProposalForm, setEditProposalForm] = useState<any | null>(null);

  const [isEditingIdea, setIsEditingIdea] = useState(false);
  const [editIdeaTitle, setEditIdeaTitle] = useState('');
  const [editIdeaProblem, setEditIdeaProblem] = useState('');
  const [editIdeaSummary, setEditIdeaSummary] = useState('');

  const [selectedRepoForLogs, setSelectedRepoForLogs] = useState<any | null>(null);
  const [repoLogs, setRepoLogs] = useState<any[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);

  const fetchRepoLogs = async (repoName: string) => {
    setLoadingLogs(true);
    try {
      const { agentApi } = await import('../services/serverApi');
      const res = await agentApi.getHistory(`develop-${repoName}`);
      setRepoLogs(res.data);
      const statusRes = await agentApi.getSessionStatus(`develop-${repoName}`);
      setIsAgentActive(statusRes.data.active);
    } catch (e) {
      console.error('Failed to fetch evolution logs', e);
      setRepoLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

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
  }, [selectedRepoForLogs]);

  const handleDiscoverIdeas = async (e: any) => {
    e.preventDefault();
    if (!discoveryTopic.trim()) return;
    await discoverIdeas(discoveryTopic);
    setDiscoveryTopic('');
  };

  const handleReviewIdea = async (ideaId: string, feedback?: string) => {
    await reviewIdea(ideaId, feedback);
    const updated = useOrganizationStore.getState().ideas.find(i => i.id === ideaId);
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

  useEffect(() => {
    fetchRoles();
    fetchDirectives();
    fetchIdeas();
    fetchAuditLogs();
    fetchRepositories();
    fetchHRProposals();
    fetchDiscoveryConfig();

    const interval = setInterval(() => {
      fetchRepositories();
      fetchIdeas();
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchRoles, fetchDirectives, fetchIdeas, fetchAuditLogs, fetchRepositories, fetchHRProposals, fetchDiscoveryConfig]);

  // Sync local settings form with store config
  useEffect(() => {
    if (discoveryConfig && !discoverySettings) {
      setDiscoverySettings({ ...discoveryConfig });
    }
  }, [discoveryConfig, discoverySettings]);

  const handleSaveIdea = async () => {
    if (!selectedIdea) return;
    try {
      await updateIdea(selectedIdea.id, {
        title: editIdeaTitle,
        problemStatement: editIdeaProblem,
        summary: editIdeaSummary
      });
      setSelectedIdea({
        ...selectedIdea,
        title: editIdeaTitle,
        problemStatement: editIdeaProblem,
        summary: editIdeaSummary
      });
      setIsEditingIdea(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* HEADER */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-white/5 bg-slate-900/40 backdrop-blur-md shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
            <span className="text-blue-500">🏛</span> AI Council Console
          </h1>
          <p className="text-[10px] text-slate-400 mt-0.5">Autonomous Strategy, Role Governance, and Sandbox Validation</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-3 py-1 rounded-full animate-pulse">Syncing...</span>}
          {error && <span className="text-xs text-red-400 font-semibold bg-red-500/10 px-3 py-1 rounded-full">{error}</span>}
        </div>
      </div>

      {/* TABS */}
      <div className="flex gap-2 px-8 py-3 border-b border-white/5 bg-slate-900/20 shrink-0 overflow-x-auto">
        {(['directives', 'roles', 'ideas', 'repos', 'audit'] as TabType[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${
              activeTab === tab ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'hover:bg-white/5 text-slate-400'
            }`}
          >
            {tab === 'directives' && '🎯 Strategy & Directives'}
            {tab === 'roles' && '👥 Roles & Recruitment'}
            {tab === 'ideas' && '💡 Venture Ideas & Council'}
            {tab === 'repos' && '📂 Repositories & Sandbox'}
            {tab === 'audit' && '📝 Audit Logs'}
          </button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-y-auto p-8 bg-slate-950/50">
        {/* DIRECTIVES */}
        {activeTab === 'directives' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Active Strategic Directives</h2>
              {directives.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/35 border border-white/5 rounded-2xl text-slate-400 text-xs">No active directives.</div>
              ) : (
                directives.map(dir => (
                  <div
                    key={dir.id}
                    onClick={() => setSelectedDirective(dir)}
                    className="p-5 bg-slate-900/40 border border-white/5 hover:border-blue-500/30 rounded-2xl flex justify-between items-start gap-4 cursor-pointer transition-all"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 uppercase">{dir.goalType}</span>
                        <span className="text-[10px] text-slate-400">Priority: {dir.priority}</span>
                      </div>
                      <h3 className="text-sm font-bold text-white">{dir.title}</h3>
                      <p className="text-xs text-slate-300 leading-relaxed">{dir.description}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelDirective(dir.id);
                      }}
                      className="px-3 py-1.5 border border-red-500/30 hover:bg-red-500/10 text-red-400 rounded-lg text-[10px] font-bold uppercase transition-all shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="bg-slate-900/20 border border-white/5 p-5 rounded-2xl space-y-4 h-fit">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Create Directive</h2>
              <form onSubmit={(e) => { e.preventDefault(); createDirective({ ...newDir, constraints: JSON.parse(newDir.constraints) }); setNewDir({ title: '', description: '', goalType: 'build', priority: 50, constraints: '{"avoidCloudDependencies": true}' }); }} className="space-y-3">
                <input type="text" required placeholder="Title" value={newDir.title} onChange={e => setNewDir({ ...newDir, title: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                <textarea required placeholder="Description" value={newDir.description} onChange={e => setNewDir({ ...newDir, description: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" rows={3} />
                <div className="grid grid-cols-2 gap-3">
                  <select value={newDir.goalType} onChange={e => setNewDir({ ...newDir, goalType: e.target.value })} className="bg-slate-900 border border-white/10 rounded-xl px-2 py-2 text-xs text-white">
                    {['explore', 'build', 'improve', 'stop', 'pivot', 'research'].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <input type="number" required min={1} max={100} value={newDir.priority} onChange={e => setNewDir({ ...newDir, priority: Number(e.target.value) })} className="bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                </div>
                <textarea placeholder="Constraints JSON" value={newDir.constraints} onChange={e => setNewDir({ ...newDir, constraints: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-[10px] text-slate-300 font-mono" rows={2} />
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Deploy</button>
              </form>
            </div>
          </div>
        )}

        {/* ROLES & RECRUITMENT */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">AI Registry Roles</h2>
                <button onClick={() => setShowRoleModal(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg uppercase">+ New Role</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roles.map(role => (
                  <div
                    key={role.id}
                    onClick={() => {
                      setSelectedRole(role);
                      setEditRoleForm({
                        name: role.name,
                        mission: role.mission,
                        description: role.description,
                        systemPrompt: role.systemPrompt,
                        toolPermissions: role.toolPermissions || [],
                        canRecruit: role.canRecruit || false,
                        canProposeRepo: role.canProposeRepo || false,
                        canProvisionValidation: role.canProvisionValidation || false
                      });
                    }}
                    className="p-5 bg-slate-900/40 border border-white/5 hover:border-blue-500/30 rounded-2xl flex flex-col justify-between gap-4 cursor-pointer transition-all"
                  >
                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-white">{role.name}</h3>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase">{role.mission}</p>
                      <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">{role.description}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        archiveRole(role.id);
                      }}
                      className="w-full text-center py-1.5 border border-red-500/30 hover:bg-red-500/10 text-red-400 rounded-lg text-[10px] font-bold uppercase transition-all"
                    >
                      Archive
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-slate-900/20 border border-white/5 p-5 rounded-2xl space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider">HR proposals</h2>
                  <button onClick={analyzeRecruitment} className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/20 hover:bg-blue-600/30 text-blue-400 text-[10px] font-bold rounded-lg uppercase">Analyze Needs</button>
                </div>
                {hrProposals.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">No hiring proposals.</p>
                ) : (
                  hrProposals.map(prop => (
                    <div key={prop.id} className="p-4 bg-slate-900/50 border border-white/5 rounded-xl space-y-3">
                      <div>
                        <h4 className="text-xs font-bold text-white">{prop.candidate_role_name}</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Need: {prop.business_need}</p>
                      </div>
                      {prop.status === 'proposed' ? (
                        <div className="flex gap-2">
                          <button onClick={() => materializeProposal(prop.id)} className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold uppercase">Materialize</button>
                          <button
                            onClick={() => {
                              setSelectedProposal(prop);
                              try {
                                setEditProposalForm({
                                  candidateRoleName: prop.candidate_role_name,
                                  businessNeed: prop.business_need,
                                  suggestedMission: prop.suggested_mission,
                                  suggestedPrompt: prop.suggested_prompt,
                                  requiredPermissions: JSON.parse(prop.required_permissions || '[]')
                                });
                              } catch {
                                setEditProposalForm({
                                  candidateRoleName: prop.candidate_role_name,
                                  businessNeed: prop.business_need,
                                  suggestedMission: prop.suggested_mission,
                                  suggestedPrompt: prop.suggested_prompt,
                                  requiredPermissions: []
                                });
                              }
                              setShowProposalModal(true);
                            }}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-bold uppercase"
                          >
                            Edit
                          </button>
                          <button onClick={() => deleteProposal(prop.id)} className="px-2 py-1 bg-red-950/40 border border-red-500/30 hover:border-red-500 text-red-400 rounded text-[10px] font-bold uppercase">Delete</button>
                        </div>
                      ) : (
                        <span className="block text-center text-[10px] bg-slate-800 text-slate-400 py-1 rounded font-bold uppercase">{prop.status}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* VENTURE IDEAS & COUNCIL */}
        {activeTab === 'ideas' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Venture Ideas</h2>
              {ideas.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/35 border border-white/5 rounded-2xl text-slate-400 text-xs">No ventures discovered.</div>
              ) : (
                ideas.map(idea => (
                  <div key={idea.id} onClick={() => setSelectedIdea(idea)} className="p-5 bg-slate-900/40 border border-white/5 hover:border-blue-500/30 transition-all cursor-pointer rounded-2xl space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-white mb-1.5">{idea.title}</h3>
                        <span className={`text-[9px] uppercase font-bold px-2 py-0.5 rounded ${
                          idea.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          idea.status === 'rejected' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          idea.status === 'reviewing' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>{idea.status}</span>
                      </div>
                      <span className="text-lg font-black text-blue-400">{(idea.overallScore * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{idea.problemStatement}</p>
                    <div className="grid grid-cols-3 gap-4 text-[10px] text-slate-400">
                      <div>Strategic: <strong className="text-slate-200">{idea.strategicScore}</strong></div>
                      <div>Feasibility: <strong className="text-slate-200">{idea.feasibilityScore}</strong></div>
                      <div>Novelty: <strong className="text-slate-200">{idea.noveltyScore}</strong></div>
                    </div>
                    {(idea.status === 'approved' || idea.status === 'rejected') && (
                      <div className="text-[10px] text-blue-400 font-bold flex items-center gap-1.5 bg-blue-500/5 p-2 rounded-xl border border-blue-500/10">
                        <span>📄 Click to view Council Debate Synthesis results</span>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      <button onClick={(e) => { e.stopPropagation(); handleReviewIdea(idea.id); }} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase transition-all">Debate Council</button>
                      <button onClick={(e) => { e.stopPropagation(); approveIdea(idea.id); }} className="px-4 py-1.5 border border-slate-500 hover:bg-slate-800 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-all">Quick Approve</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteIdea(idea.id); }} className="px-4 py-1.5 border border-red-500/50 hover:bg-red-950/40 hover:border-red-500 text-red-400 rounded-lg text-[10px] font-bold uppercase transition-all">Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="bg-slate-900/20 border border-white/5 p-5 rounded-2xl space-y-4 h-fit">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Discover Ventures</h2>
              <form onSubmit={handleDiscoverIdeas} className="space-y-3">
                <input type="text" required placeholder="Topic (e.g. secure password keeper)" value={discoveryTopic} onChange={e => setDiscoveryTopic(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Explore SearXNG</button>
              </form>

              {/* AUTONOMOUS DISCOVERY PANEL */}
              <div className="pt-2 border-t border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">🤖 Autonomous Discovery</h3>
                    {discoveryConfig && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {discoveryConfig.isRunning ? '⏳ Running...' : discoveryConfig.lastRunAt ? `Last: ${new Date(discoveryConfig.lastRunAt).toLocaleString()}` : 'Never run'}
                        {' · '}{discoveryConfig.enabled ? <span className="text-emerald-400">Enabled</span> : <span className="text-red-400">Disabled</span>}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      const res = await triggerDiscovery();
                      setTriggerResult(res.ideasFound > 0 ? `✅ Found ${res.ideasFound} new idea(s)` : (res.message || '✅ Cycle complete'));
                      await fetchIdeas();
                      await fetchDiscoveryConfig();
                      setTimeout(() => setTriggerResult(null), 5000);
                    }}
                    disabled={loading}
                    className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 text-blue-400 rounded-lg text-[10px] font-bold uppercase transition-all"
                  >
                    ▶ Trigger Now
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
                  className="text-[10px] text-slate-400 hover:text-white font-bold uppercase tracking-wider"
                >
                  {showDiscoverySettings ? '▲ Hide Settings' : '⚙ Settings'}
                </button>

                {showDiscoverySettings && discoverySettings && (
                  <div className="space-y-3 p-4 bg-slate-900/50 border border-white/5 rounded-xl">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={discoverySettings.enabled} onChange={e => setDiscoverySettings({ ...discoverySettings, enabled: e.target.checked })} className="accent-blue-500" />
                      Enabled
                    </label>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Cron Expression</label>
                      <input type="text" value={discoverySettings.cronExpression} onChange={e => setDiscoverySettings({ ...discoverySettings, cronExpression: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white font-mono" placeholder="0 */12 * * *" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Max Topics / Cycle ({discoverySettings.maxTopicsPerCycle})</label>
                      <input type="range" min={1} max={10} value={discoverySettings.maxTopicsPerCycle} onChange={e => setDiscoverySettings({ ...discoverySettings, maxTopicsPerCycle: Number(e.target.value) })} className="w-full accent-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Min Score Threshold ({discoverySettings.minScoreThreshold})</label>
                      <input type="range" min={0} max={1} step={0.05} value={discoverySettings.minScoreThreshold} onChange={e => setDiscoverySettings({ ...discoverySettings, minScoreThreshold: Number(e.target.value) })} className="w-full accent-blue-500" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={discoverySettings.autoCouncil} onChange={e => setDiscoverySettings({ ...discoverySettings, autoCouncil: e.target.checked })} className="accent-blue-500" />
                      Auto Council (high-score ideas go directly to debate)
                    </label>
                    {discoverySettings.autoCouncil && (
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Min Auto Council Score ({discoverySettings.minAutoCouncilScore})</label>
                        <input type="range" min={0} max={1} step={0.05} value={discoverySettings.minAutoCouncilScore} onChange={e => setDiscoverySettings({ ...discoverySettings, minAutoCouncilScore: Number(e.target.value) })} className="w-full accent-blue-500" />
                      </div>
                    )}
                    <button
                      onClick={async () => {
                        await updateDiscoveryConfig(discoverySettings);
                        setShowDiscoverySettings(false);
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-1.5 rounded-lg text-xs uppercase tracking-wider"
                    >
                      Save Settings
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* REPOSITORIES & VALIDATION */}
        {activeTab === 'repos' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-4">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Provisioned Repositories</h2>
              {repositories.length === 0 ? (
                <div className="p-8 text-center bg-slate-900/35 border border-white/5 rounded-2xl text-slate-400 text-xs">No repositories created.</div>
              ) : (
                repositories.map(repo => (
                  <div key={repo.id} className="p-5 bg-slate-900/40 border border-white/5 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-white">{repo.namespace}/{repo.repo_name}</h3>
                        <a href={repo.gitea_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 underline">{repo.gitea_url}</a>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        {(() => {
                          const vs = repo.validation_status;
                          const lastTrig = repo.agent_last_triggered_at;
                          const staleMs = 90 * 60 * 1000;
                          const isStale = lastTrig && (Date.now() - new Date(lastTrig).getTime() > staleMs);

                          if (vs === 'evolving') {
                            return isStale
                              ? <span className="inline-block bg-amber-500/10 text-amber-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase border border-amber-500/20" title={`Last triggered: ${lastTrig}`}>⚠ Stalled</span>
                              : <span className="inline-block bg-blue-500/10 text-blue-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase animate-pulse">⚡ Evolving</span>;
                          }
                          if (vs === 'healthy') return <span className="inline-block bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase border border-emerald-500/20">✓ Built</span>;
                          if (vs === 'broken') return <span className="inline-block bg-red-500/10 text-red-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase border border-red-500/20">✗ Failed</span>;
                          if (vs === 'needs_verification') return <span className="inline-block bg-purple-500/10 text-purple-400 text-[10px] px-2 py-0.5 rounded font-bold uppercase border border-purple-500/20">↻ Verifying</span>;
                          return <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-500/10 text-slate-400`}>{vs}</span>;
                        })()}
                      </div>

                    </div>
                    <div className="flex gap-4 text-[10px] text-slate-400">
                      <div>Template: <strong className="text-slate-200">{repo.bootstrap_template}</strong></div>
                      <div>CI/CD: <strong className="text-slate-200">{repo.ci_cd_enabled ? 'Enabled' : 'Disabled'}</strong></div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-white/5">
                      <button onClick={() => bootstrapCiCd(repo.id)} className="flex-1 py-1.5 bg-blue-600/25 border border-blue-500/20 hover:bg-blue-600/45 text-blue-300 rounded-lg text-[10px] font-bold uppercase transition-all">Bootstrap CI/CD</button>
                      <button onClick={() => runValidation(repo.id)} className="flex-1 py-1.5 bg-emerald-600/25 border border-emerald-500/20 hover:bg-emerald-600/45 text-emerald-300 rounded-lg text-[10px] font-bold uppercase transition-all">Run Kasm Validate</button>
                      <button onClick={() => setSelectedRepoForLogs(repo)} className="flex-1 py-1.5 bg-indigo-600/25 border border-indigo-500/20 hover:bg-indigo-600/45 text-indigo-300 rounded-lg text-[10px] font-bold uppercase transition-all">Evolution Logs</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="bg-slate-900/20 border border-white/5 p-5 rounded-2xl space-y-4 h-fit">
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Create Gitea Repository</h2>
              <form onSubmit={(e) => { e.preventDefault(); createRepository(newRepo); setNewRepo({ namespace: 'aimindmesh-labs', repoName: '', description: '', visibility: 'private', bootstrapTemplate: 'node-webapp', enableCiCd: true }); }} className="space-y-3">
                <input type="text" required placeholder="Repo Name" value={newRepo.repoName} onChange={e => setNewRepo({ ...newRepo, repoName: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                <input type="text" placeholder="Namespace" value={newRepo.namespace} onChange={e => setNewRepo({ ...newRepo, namespace: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
                <textarea placeholder="Description" value={newRepo.description} onChange={e => setNewRepo({ ...newRepo, description: e.target.value })} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" rows={2} />
                <div className="grid grid-cols-2 gap-3">
                  <select value={newRepo.bootstrapTemplate} onChange={e => setNewRepo({ ...newRepo, bootstrapTemplate: e.target.value })} className="bg-slate-900 border border-white/10 rounded-xl px-2 py-2 text-xs text-white">
                    {['node-webapp', 'node-library', 'docker-service', 'tauri-desktop-app', 'static-site'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={newRepo.visibility} onChange={e => setNewRepo({ ...newRepo, visibility: e.target.value })} className="bg-slate-900 border border-white/10 rounded-xl px-2 py-2 text-xs text-white">
                    {['private', 'public', 'internal'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer pt-1">
                  <input type="checkbox" checked={newRepo.enableCiCd} onChange={e => setNewRepo({ ...newRepo, enableCiCd: e.target.checked })} className="accent-blue-500" />
                  Auto Bootstrap CI/CD Actions
                </label>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Create Repo</button>
              </form>
            </div>
          </div>
        )}

        {/* AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">System Audit Trail</h2>
            <div className="bg-slate-900/25 border border-white/5 rounded-2xl overflow-hidden">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-900/50 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-4">Timestamp</th>
                    <th className="p-4">Event</th>
                    <th className="p-4">Actor</th>
                    <th className="p-4">Target</th>
                    <th className="p-4">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="p-4 text-slate-400">{new Date(log.created_at || Date.now()).toLocaleString()}</td>
                      <td className="p-4"><span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-mono uppercase">{log.event_type}</span></td>
                      <td className="p-4 text-slate-300">{log.actor_type}:{log.actor_id}</td>
                      <td className="p-4 text-slate-400">{log.target_type}:{log.target_id}</td>
                      <td className="p-4 text-slate-300 font-mono text-[10px] max-w-xs truncate">{log.payload}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* NEW ROLE MODAL */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Define New AI Role</h2>
              <button onClick={() => setShowRoleModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              createRole({
                name: newRole.name, description: newRole.description, mission: newRole.mission, systemPrompt: newRole.systemPrompt,
                toolPermissions: newRole.toolPermissions, providerPreferences: { default: 'gemini' }, memoryNamespace: `role:${newRole.name.toLowerCase().replace(/\s+/g, '-')}`, approvalPolicy: {},
                canRecruit: newRole.canRecruit, canProposeRepo: newRole.canProposeRepo, canProvisionValidation: newRole.canProvisionValidation
              });
              setNewRole({ name: '', description: '', mission: '', systemPrompt: '', toolPermissions: ['web:search'], canRecruit: false, canProposeRepo: true, canProvisionValidation: true });
              setShowRoleModal(false);
            }} className="space-y-3">
              <input type="text" required placeholder="Role Name" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              <input type="text" required placeholder="Core Mission Summary" value={newRole.mission} onChange={e => setNewRole({ ...newRole, mission: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              <textarea required placeholder="Description" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" rows={2} />
              <textarea required placeholder="System Prompt" value={newRole.systemPrompt} onChange={e => setNewRole({ ...newRole, systemPrompt: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono" rows={4} />
              <div className="flex gap-4 py-1">
                {[['canRecruit', 'Hiring permissions'], ['canProposeRepo', 'Repo permissions'], ['canProvisionValidation', 'Sandbox validation']].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={(newRole as any)[k]} onChange={e => setNewRole({ ...newRole, [k]: e.target.checked })} className="accent-blue-500" />
                    {label}
                  </label>
                ))}
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Create Role</button>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ROLE MODAL */}
      {selectedRole && editRoleForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-slate-100">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Edit Role Detail</h2>
                <p className="text-[10px] text-slate-400">ID: {selectedRole.id}</p>
              </div>
              <button onClick={() => { setSelectedRole(null); setEditRoleForm(null); }} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              await updateRole(selectedRole.id, editRoleForm);
              setSelectedRole(null);
              setEditRoleForm(null);
            }} className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Role Name</label>
                <input type="text" required placeholder="Role Name" value={editRoleForm.name} onChange={e => setEditRoleForm({ ...editRoleForm, name: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Core Mission Summary</label>
                <input type="text" required placeholder="Core Mission Summary" value={editRoleForm.mission} onChange={e => setEditRoleForm({ ...editRoleForm, mission: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Description</label>
                <textarea required placeholder="Description" value={editRoleForm.description} onChange={e => setEditRoleForm({ ...editRoleForm, description: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" rows={3} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">System Prompt</label>
                <textarea required placeholder="System Prompt" value={editRoleForm.systemPrompt} onChange={e => setEditRoleForm({ ...editRoleForm, systemPrompt: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono" rows={5} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Tool Permissions (comma separated)</label>
                <input type="text" placeholder="Permissions (e.g. web:search, file:read)" value={editRoleForm.toolPermissions ? editRoleForm.toolPermissions.join(', ') : ''} onChange={e => setEditRoleForm({ ...editRoleForm, toolPermissions: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div className="flex gap-4 py-1">
                {[['canRecruit', 'Hiring permissions'], ['canProposeRepo', 'Repo permissions'], ['canProvisionValidation', 'Sandbox validation']].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={!!editRoleForm[k]} onChange={e => setEditRoleForm({ ...editRoleForm, [k]: e.target.checked })} className="accent-blue-500" />
                    {label}
                  </label>
                ))}
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Save Changes</button>
            </form>
          </div>
        </div>
      )}

      {/* VIEW DIRECTIVE DETAIL MODAL */}
      {selectedDirective && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-slate-100">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Strategic Directive Detail</h2>
                <p className="text-[10px] text-slate-400">ID: {selectedDirective.id}</p>
              </div>
              <button onClick={() => setSelectedDirective(null)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Goal Type</span>
                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 uppercase">{selectedDirective.goalType}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Priority</span>
                  <span className="block mt-1 text-xs font-bold text-white">{selectedDirective.priority} / 100</span>
                </div>
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Title</span>
                <h3 className="text-sm font-bold text-white mt-1">{selectedDirective.title}</h3>
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Description</span>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">{selectedDirective.description}</p>
              </div>
              <div>
                <span className="block text-[10px] text-slate-500 uppercase font-bold">Constraints & Policy JSON</span>
                <pre className="bg-slate-950 p-4 rounded-xl border border-white/5 font-mono text-[10px] text-slate-300 overflow-x-auto mt-1 max-h-48">
                  {typeof selectedDirective.constraints === 'object'
                    ? JSON.stringify(selectedDirective.constraints, null, 2)
                    : selectedDirective.constraints}
                </pre>
              </div>
              <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-400 pt-2 border-t border-white/5">
                <div>Created: <strong>{new Date(selectedDirective.createdAt || Date.now()).toLocaleString()}</strong></div>
                <div>Created By: <strong>{selectedDirective.createdBy}</strong></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW IDEA DETAIL MODAL */}
      {selectedIdea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-slate-100">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Venture Idea Detail</h2>
                <p className="text-[10px] text-slate-400">ID: {selectedIdea.id}</p>
              </div>
              <button onClick={() => { setSelectedIdea(null); setIsEditingIdea(false); }} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-slate-950 p-4 rounded-xl border border-white/5">
                <div>
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Status</span>
                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 uppercase">{selectedIdea.status}</span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Overall Score</span>
                  <span className="block mt-1 text-lg font-black text-blue-400">{(selectedIdea.overallScore * 100).toFixed(0)} / 100</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-slate-950/40 p-3 rounded-xl border border-white/5">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Strategic</span>
                  <span className="text-sm font-bold text-slate-200">{selectedIdea.strategicScore}</span>
                </div>
                <div className="bg-slate-950/40 p-3 rounded-xl border border-white/5">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Feasibility</span>
                  <span className="text-sm font-bold text-slate-200">{selectedIdea.feasibilityScore}</span>
                </div>
                <div className="bg-slate-950/40 p-3 rounded-xl border border-white/5">
                  <span className="block text-[10px] text-slate-500 uppercase font-bold">Novelty</span>
                  <span className="text-sm font-bold text-slate-200">{selectedIdea.noveltyScore}</span>
                </div>
              </div>

              {isEditingIdea ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold">Title</label>
                    <input
                      type="text"
                      value={editIdeaTitle}
                      onChange={(e) => setEditIdeaTitle(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold">Problem Statement</label>
                    <textarea
                      value={editIdeaProblem}
                      onChange={(e) => setEditIdeaProblem(e.target.value)}
                      rows={4}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 mt-1 resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold">Summary</label>
                    <textarea
                      value={editIdeaSummary}
                      onChange={(e) => setEditIdeaSummary(e.target.value)}
                      rows={4}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 mt-1 resize-y"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveIdea}
                      disabled={loading}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setIsEditingIdea(false)}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="block text-[10px] text-slate-500 uppercase font-bold">Title</span>
                    <h3 className="text-sm font-bold text-white mt-1">{selectedIdea.title}</h3>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-500 uppercase font-bold">Problem Statement</span>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">{selectedIdea.problemStatement || 'N/A'}</p>
                  </div>

                  <div>
                    <span className="block text-[10px] text-slate-500 uppercase font-bold">Summary</span>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed whitespace-pre-wrap">{selectedIdea.summary || 'N/A'}</p>
                  </div>

                  {selectedIdea.status === 'proposed' && (
                    <button
                      onClick={() => {
                        setEditIdeaTitle(selectedIdea.title);
                        setEditIdeaProblem(selectedIdea.problemStatement || '');
                        setEditIdeaSummary(selectedIdea.summary || '');
                        setIsEditingIdea(true);
                      }}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-750 text-white border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                    >
                      ✏️ Edit Proposal
                    </button>
                  )}
                </div>
              )}

              <div className="bg-slate-950 p-4 rounded-xl border border-white/5 space-y-3 mt-2">
                <span className="block text-[10px] text-slate-400 uppercase font-bold">Intervene / Integrate Human Feedback</span>
                <textarea
                  value={humanFeedbackText}
                  onChange={(e) => setHumanFeedbackText(e.target.value)}
                  placeholder="Enter suggestions, constraints, or new directions to guide the Council's debate..."
                  rows={3}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white resize-none focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await handleReviewIdea(selectedIdea.id, humanFeedbackText);
                  }}
                  disabled={loading}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
                >
                  {loading ? '⚙️ Running Debate...' : '💬 Integrate & Re-Debate'}
                </button>
              </div>

              {selectedIdea.analysisSynthesis && (
                <div className="space-y-3">
                  <div className="bg-slate-950 p-4 rounded-xl border border-blue-500/20 mt-2">
                    <span className="block text-[10px] text-blue-400 uppercase font-bold mb-1">🤖 Council Debate Synthesis</span>
                    <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">{selectedIdea.analysisSynthesis}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await generateDirectivesFromIdea(selectedIdea.id);
                      setSelectedIdea(null);
                    }}
                    disabled={loading}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                  >
                    {loading ? '⚙️ Processing Recommendations...' : '⚙️ Generate Directives from Recommendations'}
                  </button>
                  {selectedIdea.status === 'approved' && (
                    <button
                      onClick={async () => {
                        await transitionIdeaToDevelopment(selectedIdea.id);
                        setSelectedIdea(null);
                      }}
                      disabled={loading}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {loading ? '🚀 Transitioning to Development...' : '🚀 Transition to Development (Auto Repos & Directives)'}
                    </button>
                  )}
                </div>
              )}

              {selectedIdea.sourceSignals && selectedIdea.sourceSignals.length > 0 && (
                <div>
                  <span className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5">Source Signals</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedIdea.sourceSignals.map((sig: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-slate-800 border border-white/5 rounded-lg text-[10px] text-slate-300">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-400 pt-2 border-t border-white/5">
                <div>Created: <strong>{new Date(selectedIdea.createdAt || Date.now()).toLocaleString()}</strong></div>
                <div>Updated: <strong>{new Date(selectedIdea.updatedAt || Date.now()).toLocaleString()}</strong></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EVOLUTION LOGS MODAL */}
      {selectedRepoForLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 shrink-0">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>🧬</span> Developer Agent Evolution Stream
                </h2>
                <p className="text-[10px] text-slate-400 mt-0.5 font-mono flex items-center gap-1.5">
                  <span>Session: develop-{selectedRepoForLogs.repo_name}</span>
                  {isAgentActive ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8px] font-bold rounded uppercase tracking-wider animate-pulse">
                      <span className="w-1 h-1 bg-emerald-500 rounded-full animate-ping"></span>
                      Working
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-slate-500/10 text-slate-400 text-[8px] font-bold rounded uppercase tracking-wider">
                      Idle
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {loadingLogs && <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded-full animate-pulse">Streaming logs...</span>}
                <button
                  onClick={async () => {
                    if (window.confirm("Are you sure you want to clear this session's history and restart it from scratch?")) {
                      try {
                        const { agentApi } = await import('../services/serverApi');
                        await agentApi.clearSession(`develop-${selectedRepoForLogs.repo_name}`);
                        setRepoLogs([]);
                        alert("Session history cleared. Start the evolution again from the UI to initialize a fresh run.");
                      } catch (err: any) {
                        alert("Failed to clear session: " + err.message);
                      }
                    }
                  }}
                  className="px-2 py-1 text-[10px] bg-red-950 hover:bg-red-900 border border-red-500/30 text-red-200 rounded font-bold uppercase transition-all"
                >
                  Reset Session
                </button>
                <button onClick={() => { setSelectedRepoForLogs(null); setRepoLogs(null); }} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-950/80 border border-white/5 p-4 rounded-xl font-mono text-xs text-slate-300 space-y-3 min-h-[300px]">
              {repoLogs === null ? (
                <div className="text-center py-12 text-slate-500">Loading evolution trace...</div>
              ) : repoLogs.length === 0 ? (
                <div className="text-center py-12 text-slate-500">No evolution logs yet. The agent may still be initializing or starting the Gitea workspace.</div>
              ) : (
                repoLogs.map((msg: any, idx: number) => {
                  const isThought = msg.role === 'thought' || (msg.content && msg.content.includes('Thought:'));
                  return (
                    <div key={idx} className={`p-3 rounded-lg border ${
                      msg.role === 'user' ? 'bg-blue-950/20 border-blue-500/15 text-blue-300' :
                      isThought ? 'bg-amber-950/15 border-amber-500/10 text-amber-400/90 italic' :
                      'bg-slate-900/50 border-white/5 text-slate-200'
                    }`}>
                      <div className="text-[9px] uppercase font-bold opacity-60 mb-1">
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
      {/* EDIT PROPOSAL MODAL */}
      {showProposalModal && selectedProposal && editProposalForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto text-slate-100">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Edit HR Proposal</h2>
                <p className="text-[10px] text-slate-400">ID: {selectedProposal.id}</p>
              </div>
              <button onClick={() => { setShowProposalModal(false); setSelectedProposal(null); setEditProposalForm(null); }} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              await updateProposal(selectedProposal.id, editProposalForm);
              setShowProposalModal(false);
              setSelectedProposal(null);
              setEditProposalForm(null);
            }} className="space-y-3">
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Candidate Role Name</label>
                <input type="text" required value={editProposalForm.candidateRoleName} onChange={e => setEditProposalForm({ ...editProposalForm, candidateRoleName: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Business Need</label>
                <textarea required value={editProposalForm.businessNeed} onChange={e => setEditProposalForm({ ...editProposalForm, businessNeed: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" rows={2} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Suggested Mission</label>
                <input type="text" required value={editProposalForm.suggestedMission} onChange={e => setEditProposalForm({ ...editProposalForm, suggestedMission: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Suggested Prompt</label>
                <textarea required value={editProposalForm.suggestedPrompt} onChange={e => setEditProposalForm({ ...editProposalForm, suggestedPrompt: e.target.value })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono" rows={4} />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">Permissions (comma separated)</label>
                <input type="text" placeholder="Permissions (e.g. gitea:read)" value={editProposalForm.requiredPermissions ? editProposalForm.requiredPermissions.join(', ') : ''} onChange={e => setEditProposalForm({ ...editProposalForm, requiredPermissions: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider">Save Changes</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
