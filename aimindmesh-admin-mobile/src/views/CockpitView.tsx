import { useEffect, useCallback, useRef, useState } from 'react';
import { Cpu, HardDrive, Zap, RefreshCw, Activity, BrainCircuit, ShieldCheck, Server, Cloud, Play, Layers, BookOpen, Clock, XCircle, Pause, ShieldAlert, Trash2 } from 'lucide-react';
import { useNavigationStore } from '../store/navigationStore';
import { useAdminStore } from '../store/adminStore';
import { adminApi, wikiApi } from '../services/api';
import { TaskPriorityManager } from '../components/TaskPriorityManager';


export default function CockpitView() {
  const { status, config, isLoading, error, ollamaRunning, init, fetchStatus, toggleBrake } = useAdminStore();
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      await fetchStatus();
      startPolling();
    }, 15000);
  }, [fetchStatus]);

  useEffect(() => {
    init().then(() => { startPolling(); });
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  const handleTrigger = async () => {
    try {
      setIsTriggering(true);
      const res = await adminApi.triggerProactive();
      if (res.data.ok) alert("✅ Proactive cycle triggered successfully");
      else alert("⚠️ " + (res.data.message || "Cycle skip: already running"));
      // Give server a moment to register tasks
      setTimeout(fetchStatus, 1000);
      setTimeout(fetchStatus, 3000);
    } catch (e: any) {
      alert("❌ Trigger failed: " + (e.response?.data?.error || e.message));
      console.error("Trigger failed", e);
    } finally {
      setIsTriggering(false);
    }
  };

  const handleWikiTrigger = async () => {
    try {
      setIsTriggering(true);
      const res = await wikiApi.runCycle();
      if (res.data.ok || res.data.started) alert("✅ Wiki synthesis cycle triggered");
      else alert("⚠️ " + (res.data.message || "Synthesis skip: already running"));
      setTimeout(fetchStatus, 1000);
      setTimeout(fetchStatus, 3000);
    } catch (e: any) {
      alert("❌ Wiki trigger failed: " + (e.response?.data?.error || e.message));
      console.error("Wiki trigger failed", e);
    } finally {
      setIsTriggering(false);
    }
  };

  const updateConfigField = async (path: string, value: any) => {
    const parts = path.split('.');
    const update: any = {};
    let curr = update;
    for (let i = 0; i < parts.length - 1; i++) {
      curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = value;

    try {
      await useAdminStore.getState().patchConfig(update);
    } catch (e) {
      console.error("Config update failed", e);
    }
  };


  if (isLoading && !status) {
    return (
      <div className="view-content flex flex-col items-center justify-center gap-4 opacity-50">
        <Activity className="w-10 h-10 text-primary animate-pulse" />
        <p className="text-xs font-black uppercase tracking-[0.4em] animate-pulse">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="view-content p-4 pb-6 custom-scrollbar animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-2xl font-black tracking-tighter italic">CORE CONSOLE</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">AI System Monitor</p>
        </div>
        <button onClick={() => { init(); }} className="p-3 rounded-2xl bg-surface border border-border active:scale-90 transition-all">
          <RefreshCw size={18} className="text-primary" />
        </button>
      </div>

      {/* Connection Error */}
      {error && !status && (
        <div className="p-5 rounded-3xl bg-error/10 border border-error/30 mb-4 flex items-center gap-3">
          <ShieldCheck size={18} className="text-error shrink-0" />
          <div>
            <p className="text-xs font-black uppercase text-error">Telemetry Offline</p>
            <p className="text-[10px] text-error/70 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Quarantine Alert */}
      {status?.failedHistory && status.failedHistory.length > 0 && (
        <button
          onClick={() => useNavigationStore.getState().setActiveTab('quarantine')}
          className="w-full p-4 rounded-3xl bg-error/10 border border-error/20 mb-4 flex items-center justify-between animate-pulse active:scale-95 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-error/20">
              <ShieldAlert size={18} className="text-error" />
            </div>
            <div className="text-left">
              <p className="text-xs font-black uppercase text-error">Quarantine Active</p>
              <p className="text-[10px] text-error/70 font-bold uppercase">{status.failedHistory.length} Failed Tasks Detected</p>
            </div>
          </div>
          <div className="px-3 py-1 bg-error text-white text-[9px] font-black uppercase rounded-xl tracking-widest">
            VIEW
          </div>
        </button>
      )}

      {/* Server Status Banner */}
      {status && (
        <div className={`p-5 rounded-3xl border mb-4 flex items-center justify-between ${ollamaRunning ? 'bg-success/5 border-success/20' : 'bg-surface border-border'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl ${ollamaRunning ? 'bg-success/20' : 'bg-muted'}`}>
              <Server size={18} className={ollamaRunning ? 'text-success' : 'text-muted-foreground'} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-tight">Cloud Node</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">10.2.0.1:3030</p>
            </div>
          </div>
          <span className={`status-badge ${ollamaRunning ? 'online' : 'offline'}`}>
            <span className={ollamaRunning ? 'dot-online' : 'dot-offline'} />
            {ollamaRunning ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
      )}

      {/* Metrics Grid */}
      {status && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Cpu size={14} className="text-primary opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Compute</span>
            </div>
            <p className="text-2xl font-black font-mono">{status.cpu ?? '--'}<span className="text-sm text-muted-foreground">%</span></p>
            <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${status.cpu || 0}%` }} />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <HardDrive size={14} className="text-success opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Memory</span>
            </div>
            <p className="text-2xl font-black font-mono">{status.ram?.percent ?? '--'}<span className="text-sm text-muted-foreground">%</span></p>
            <p className="text-[10px] text-muted-foreground mt-1">{status.ram?.used} / {status.ram?.total}</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-warning opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Gemini Quota</span>
            </div>
            <p className="text-2xl font-black font-mono">
              {status.dailyQuotaCap ? Math.round((status.geminiUsage / status.dailyQuotaCap) * 100) : 0}
              <span className="text-sm text-muted-foreground">%</span>
            </p>
            <div className="flex justify-between items-end mt-1">
              <p className="text-[10px] text-muted-foreground">{status.geminiUsage?.toLocaleString()} tokens</p>
              <p className="text-[8px] font-bold text-muted-foreground/50 uppercase">{config?.gemini?.model?.split('/').pop() || 'GEMINI'}</p>
            </div>
          </div>

          <div className="metric-card group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Cloud size={14} className="text-cyan-400 opacity-70" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">OpenRouter</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); useAdminStore.getState().refreshCredits(); }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/5 rounded-md transition-all"
              >
                <RefreshCw size={10} className="text-muted-foreground" />
              </button>
            </div>
            <p className="text-2xl font-black font-mono">
              <span className="text-sm text-cyan-400 mr-1">$</span>
              {status.openrouterCredits?.balance.toFixed(2) ?? '--'}
            </p>
            <div className="h-1 bg-surface-hover rounded-full mt-2 overflow-hidden border border-border/10">
              <div
                className="h-full bg-cyan-400 rounded-full transition-all duration-1000"
                style={{
                  width: `${status.openrouterCredits?.total_credits ? Math.min(100, (status.openrouterCredits.total_usage / status.openrouterCredits.total_credits) * 100) : 0}%`
                }}
              />
            </div>
            <div className="flex justify-between items-end mt-1">
              <p className="text-[10px] text-muted-foreground">Used: ${status.openrouterCredits?.total_usage.toFixed(2) ?? '--'}</p>
              <p className="text-[8px] font-bold text-muted-foreground/50 uppercase">{config?.openrouter?.model?.split('/').pop() || 'CLAUDE'}</p>
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <BrainCircuit size={14} className="text-purple-400 opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Nodes</span>
            </div>
            <p className="text-2xl font-black font-mono">{status.nodes?.length ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {status.nodes?.filter(n => n.status === 'ONLINE').length ?? 0} online
            </p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Activity size={14} className="text-blue-400 opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">LLM Queue</span>
            </div>
            <p className="text-2xl font-black font-mono">{status.inferenceQueue?.length ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {status.inferenceQueue?.filter((i: any) => i.status === 'PROCESSING').length ?? 0} processing
            </p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-orange-400 opacity-70" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Executions</span>
            </div>
            <p className="text-2xl font-black font-mono">{status.runningTasksCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Running AI tasks</p>
          </div>

          <div className={`metric-card border-2 ${status.openClawHealth?.isHealthy ? 'border-success/20' : 'border-error/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={14} className={status.openClawHealth?.isHealthy ? 'text-success' : 'text-error'} />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">OpenClaw Agent</span>
            </div>
            <p className={`text-sm font-black uppercase tracking-tighter truncate ${status.openClawHealth?.isHealthy ? 'text-success' : 'text-error'}`}>
              {status.openClawHealth?.statusMessage || 'Initializing...'}
            </p>
            <div className="flex justify-between items-end mt-2">
              <p className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                {status.openClawHealth?.lastCheck ? new Date(status.openClawHealth.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Waiting'}
              </p>
              <Activity size={10} className={status.openClawHealth?.isHealthy ? 'text-success animate-pulse' : 'text-error'} />
            </div>
          </div>

          <div className={`metric-card border-2 ${status.hermesHealth?.isHealthy ? 'border-purple-500/20' : 'border-error/20'}`}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={14} className={status.hermesHealth?.isHealthy ? 'text-purple-400' : 'text-error'} />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Hermes Agent</span>
            </div>
            <p className={`text-sm font-black uppercase tracking-tighter truncate ${status.hermesHealth?.isHealthy ? 'text-purple-400' : 'text-error'}`}>
              {status.hermesHealth?.statusMessage || 'Initializing...'}
            </p>
            <div className="flex justify-between items-end mt-2">
              <p className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-widest">
                {status.hermesHealth?.lastCheck ? new Date(status.hermesHealth.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Waiting'}
              </p>
              <Activity size={10} className={status.hermesHealth?.isHealthy ? 'text-purple-400 animate-pulse' : 'text-error'} />
            </div>
          </div>
        </div>
      )}

      {/* Infrastructure Brake Button */}
      {status && (
        <button
          onClick={() => toggleBrake(!status.infrastructureBrake)}
          className={`w-full p-5 rounded-[32px] border-2 mb-4 flex items-center gap-4 transition-all active:scale-[0.98] ${status.infrastructureBrake ? 'bg-error border-error shadow-lg shadow-error/20' : 'bg-error/10 border-error/20'}`}
        >
          <div className={`p-3 rounded-2xl ${status.infrastructureBrake ? 'bg-white text-error' : 'bg-error text-white'}`}>
            <ShieldCheck size={20} className={status.infrastructureBrake ? 'animate-pulse' : ''} />
          </div>
          <div className="flex-1 text-left">
            <p className={`text-xs font-black uppercase tracking-tight ${status.infrastructureBrake ? 'text-white' : 'text-foreground'}`}>
              {status.infrastructureBrake ? 'Brake: ENGAGED' : 'Brake: READY'}
            </p>
            <p className={`text-[9px] font-bold ${status.infrastructureBrake ? 'text-white/80' : 'text-muted-foreground'}`}>
              {status.infrastructureBrake ? 'SYSTEM PAUSED' : 'Manual System Throttle'}
            </p>
          </div>
          <div className={`px-4 py-1.5 rounded-xl border font-black text-[9px] uppercase tracking-widest ${status.infrastructureBrake ? 'bg-white/20 border-white/40 text-white' : 'bg-error/10 border-error/30 text-error'}`}>
            {status.infrastructureBrake ? 'RELEASE' : 'ENGAGE'}
          </div>
        </button>
      )}

      {/* Cloud Services */}
      {status && (
        <div className="glass-panel rounded-3xl p-5 mb-4">
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground mb-4">Cloud Services</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-2xl ${status.fcmStatus?.configured ? 'bg-orange-500/20' : 'bg-muted'}`}>
                <Zap size={18} className={status.fcmStatus?.configured ? 'text-orange-400' : 'text-muted-foreground'} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-tight">Firebase / FCM</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {status.fcmStatus?.configured ? 'Auth: service-account.json' : 'Auth: Missing key file'}
                </p>
              </div>
            </div>
            <span className={`status-badge ${status.fcmStatus?.configured ? 'online' : 'offline'}`}>
              {status.fcmStatus?.configured ? 'READY' : 'MISSING'}
            </span>
          </div>
        </div>
      )}

      {/* Node List */}
      {status?.nodes && status.nodes.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 mb-4">
          <h2 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground mb-4">Cluster Nodes</h2>
          <div className="space-y-2">
            {status.nodes.map(node => (
              <div key={node.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div>
                  <p className="text-xs font-black uppercase tracking-tight">{node.id}</p>
                  <p className="text-[10px] text-muted-foreground">{node.url}</p>
                </div>
                <span className={`status-badge text-[9px] ${node.status === 'ONLINE' ? 'online' : 'offline'}`}>
                  {node.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Task Routing Priorities */}
      {status && config && (
        <TaskPriorityManager
          priorities={config?.routing?.taskPriorities || {}}
          onChange={(taskPriorities) => updateConfigField('routing.taskPriorities', taskPriorities)}
          availableNodes={status?.nodes || []}
        />
      )}

      {/* Brain Core Controls */}
      {status && config && (
        <div className="glass-panel rounded-3xl p-5 mb-4">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">Synthesis Engine</h2>
            <div className="flex items-center gap-2">
              <span className={`status-badge ${config?.proactive?.enabled ? 'online' : 'offline'}`}>
                {config?.proactive?.enabled ? 'AUTONOMOUS' : 'MANUAL'}
              </span>
            </div>
          </div>

          <div className="space-y-5">
            {/* Main Toggle */}
            <div className="flex items-center justify-between p-3 bg-surface/50 border border-border/50 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${config?.proactive?.enabled ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  <Zap size={16} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-tight">Auto Synthesis</p>
                  <p className="text-[9px] text-muted-foreground uppercase font-bold tracking-tighter">Periodic background engine</p>
                </div>
              </div>
              <button
                onClick={() => updateConfigField('proactive.enabled', !config?.proactive?.enabled)}
                className={`w-12 h-6 rounded-full transition-all relative ${config?.proactive?.enabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${config?.proactive?.enabled ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Settings Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-surface/30 border border-border/30 rounded-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <Clock size={12} className="text-muted-foreground" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Interval</span>
                </div>
                <div className="flex items-end gap-1">
                  <input
                    type="number"
                    value={config?.proactive?.intervalHours || 12}
                    onChange={(e) => updateConfigField('proactive.intervalHours', parseInt(e.target.value))}
                    className="bg-transparent text-xl font-black font-mono w-12 outline-none border-b border-border focus:border-primary transition-all"
                  />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase pb-1">Hours</span>
                </div>
              </div>

              <div className="p-3 bg-surface/30 border border-border/30 rounded-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <Activity size={12} className="text-muted-foreground" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Threshold</span>
                </div>
                <div className="flex items-end gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={config?.proactive?.relevanceThreshold || 0.7}
                    onChange={(e) => updateConfigField('proactive.relevanceThreshold', parseFloat(e.target.value))}
                    className="bg-transparent text-xl font-black font-mono w-14 outline-none border-b border-border focus:border-primary transition-all"
                  />
                  <span className="text-[10px] font-bold text-muted-foreground uppercase pb-1">Score</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <button onClick={handleTrigger} disabled={isTriggering} className="btn-primary w-full py-4 rounded-2xl">
                <BrainCircuit size={18} className={isTriggering ? 'animate-pulse' : ''} />
                Force Proactive Cycle
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleWikiTrigger}
                  disabled={isTriggering}
                  className="p-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <BookOpen size={14} /> Wiki Cycle
                </button>
                <button
                  onClick={async () => {
                    setIsTriggering(true);
                    try {
                      const res = await adminApi.mergeDebate();
                      if (res.data.ok) alert("✅ Merge cycle started");
                      else alert("⚠️ " + (res.data.message || "Merge skipped"));
                    } catch (e: any) {
                      alert("❌ Merge failed");
                    } finally {
                      setIsTriggering(false);
                      setTimeout(fetchStatus, 1000);
                    }
                  }}
                  disabled={isTriggering}
                  className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Layers size={14} /> Merge
                </button>
              </div>

              <button
                onClick={async () => {
                  setIsTriggering(true);
                  try {
                    const res = await adminApi.reprocessDebate(20);
                    if (res.data.ok) alert("✅ Reprocess cycle started");
                    else alert("⚠️ " + (res.data.message || "Skip: already active"));
                  } catch (e: any) {
                    alert("❌ Reprocess failed");
                  } finally {
                    setIsTriggering(false);
                    setTimeout(fetchStatus, 1000);
                  }
                }}
                disabled={isTriggering}
                className="p-3 bg-warning/10 border border-warning/20 text-warning rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <RefreshCw size={14} className={isTriggering ? 'animate-spin' : ''} /> Full Reprocess Cycle
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Activity Queue Details */}
      {status?.inferenceQueue && status.inferenceQueue.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
              <Activity size={14} /> Activity Queue
            </h2>
            <span className="text-[10px] font-black text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
              {status.inferenceQueue.length} TASKS
            </span>
          </div>
          <div className="space-y-3">
            {status.inferenceQueue.map((item: any, idx: number) => (
              <div key={item.id} className={`p-4 bg-surface/50 border rounded-2xl flex flex-col gap-3 transition-all ${item.status === 'PROCESSING' ? 'border-primary/40 ring-1 ring-primary/10' : 'border-border/50'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-black tracking-tight truncate uppercase italic ${item.status === 'PAUSED' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {item.taskName || 'Unnamed Inference'}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-mono font-bold opacity-40 uppercase tracking-tighter mt-0.5">{item.type} PHASE</p>
                  </div>
                  <div className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter ${item.status === 'PROCESSING' ? 'bg-success/20 text-success' :
                      item.status === 'QUEUED' ? 'bg-warning/20 text-warning' :
                        item.status === 'WAITING' ? 'bg-orange-500/20 text-orange-400 animate-pulse' :
                          item.status === 'STALLED' ? 'bg-error/20 text-error animate-pulse' :
                            'bg-muted/20 text-muted-foreground'
                    }`}>
                    {item.status}
                  </div>
                </div>

                <div className={`flex items-center justify-between rounded-xl p-2 px-3 ${item.status === 'STALLED' ? 'bg-error/5 border border-error/20' : 'bg-background/50'}`}>
                  <div className="flex flex-col gap-0.5">
                    {item.status === 'PROCESSING' ? (
                      <span className="flex items-center gap-1.5 text-[9px] font-black text-success uppercase italic">
                        <Zap size={10} className="animate-pulse" />
                        Active: {item.processingStartedAt ? formatElapsed(item.processingStartedAt, Date.now()) : 'Init...'}
                      </span>
                    ) : item.status === 'STALLED' ? (
                      <span className="flex items-center gap-1.5 text-[9px] font-black text-error uppercase italic">
                        <XCircle size={10} />
                        STALLED: RETRIES EXHAUSTED
                      </span>
                    ) : item.status === 'WAITING' ? (
                      <span className="flex items-center gap-1.5 text-[9px] font-black text-orange-400 uppercase italic">
                        <Clock size={10} className="animate-spin-slow" />
                        GEMINI COOLDOWN: RETRYING SOON...
                      </span>
                    ) : item.status === 'QUEUED' ? (
                      <span className="text-[9px] font-black text-muted-foreground uppercase italic opacity-60">
                        Pos: {idx + 1} | In: {formatDateTime(item.startedAt)}
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-muted-foreground uppercase italic opacity-60">
                        In Queue: {formatDateTime(item.startedAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={item.status === 'PROCESSING'}
                      value={item.provider || 'AUTO'}
                      onChange={(e) => { adminApi.updateInferenceRouting(item.id, e.target.value); setTimeout(fetchStatus, 500); }}
                      className="bg-surface border border-border/50 rounded-lg px-2 py-1 text-[8px] font-black uppercase tracking-widest outline-none disabled:opacity-50"
                    >
                      <option value="AUTO">AUTO</option>
                      {status?.nodes?.map((node: any) => (
                        <option key={node.id} value={node.id.toUpperCase()}>
                          {node.id === 'SERVER_LOCAL' ? 'OLLAMA' : (node.type === 'pc_client' || node.id === 'LAPTOP') ? 'LAPTOP' : node.id.toUpperCase()}
                        </option>
                      ))}
                      <option value="GEMINI_API">GEMINI</option>
                      <option value="OPENROUTER_API">OPENROUTER</option>
                      <option value="FREELLMAPI">FREELLMAPI</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono font-bold text-muted-foreground uppercase opacity-40">
                      ID: {item.id.slice(0, 8)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.status === 'PAUSED' ? (
                      <button onClick={() => { adminApi.resumeInference(item.id); setTimeout(fetchStatus, 500); }} className="p-2 text-success bg-success/10 rounded-xl active:scale-90 transition-all">
                        <Play size={14} fill="currentColor" />
                      </button>
                    ) : (item.status === 'QUEUED' || item.status === 'PROCESSING' || item.status === 'STALLED' || item.status === 'WAITING') ? (
                      <>
                        {item.status === 'STALLED' && (
                          <button onClick={() => { adminApi.retryInference(item.id); setTimeout(fetchStatus, 500); }} className="p-2 text-primary bg-primary/10 rounded-xl active:scale-90 transition-all">
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button onClick={() => { adminApi.pauseInference(item.id); setTimeout(fetchStatus, 500); }} className="p-2 text-warning bg-warning/10 rounded-xl active:scale-90 transition-all">
                          <Pause size={14} />
                        </button>
                      </>
                    ) : null}
                    <button onClick={() => { adminApi.cancelInference(item.id); setTimeout(fetchStatus, 500); }} className="p-2 text-error bg-error/10 rounded-xl active:scale-90 transition-all">
                      <XCircle size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution History */}
      {status?.queueHistory && status.queueHistory.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
              <Clock size={14} /> Execution History
            </h2>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (window.confirm("Clear all execution history?")) {
                    await adminApi.clearQueueHistory();
                    init();
                  }
                }}
                className="p-2 bg-white/5 border border-white/10 rounded-xl active:scale-90 transition-all"
              >
                <Trash2 size={14} className="text-muted-foreground/60" />
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {[...(status.queueHistory || [])].sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0)).slice(0, 20).map((item: any) => (
              <div key={item.id} className="p-3 bg-surface/30 border border-border/30 rounded-2xl flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className={`w-1.5 h-1.5 rounded-full ${item.status === 'COMPLETED' ? 'bg-success' : 'bg-error'}`} />
                    <p className="text-[11px] font-black truncate uppercase italic text-foreground/90">
                      {item.task_name || 'Inference'}
                    </p>
                  </div>
                  <button onClick={() => { adminApi.retryInference(item.id); setTimeout(fetchStatus, 500); }} className="p-1.5 bg-primary/10 text-primary rounded-lg active:scale-90 transition-all">
                    <RefreshCw size={12} />
                  </button>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] font-mono font-bold text-muted-foreground uppercase">{item.model || 'AUTO'}</span>
                      <span className="text-[8px] font-mono font-bold opacity-30">|</span>
                      <span className="text-[8px] font-mono font-bold opacity-50">IN: {formatDateTime(item.created_at)}</span>
                      {item.completed_at && (
                        <>
                          <span className="text-[8px] font-mono font-bold opacity-30">|</span>
                          <span className="text-[8px] font-mono font-bold opacity-50">OUT: {formatDateTime(item.completed_at)}</span>
                        </>
                      )}
                    </div>
                    {item.completed_at && (
                      <span className="text-[8px] font-black uppercase tracking-widest text-primary/60 italic">
                        DURATION: {formatElapsed(item.created_at, item.completed_at)}
                      </span>
                    )}
                  </div>
                  <span className={`text-[8px] font-black uppercase tracking-widest ${item.status === 'COMPLETED' ? 'text-success/80' : 'text-error'}`}>
                    {item.status}
                  </span>
                </div>
                {item.error_msg && (
                  <p className="text-[9px] text-error/80 font-medium leading-tight mt-1 line-clamp-2 bg-error/5 p-2 rounded-lg border border-error/10">
                    {item.error_msg}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDateTime(ts: number | string) {
  if (!ts) return '--';
  const date = new Date(Number(ts));
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatElapsed(start: number, end: number) {
  if (!start || !end) return '--';
  const diff = Number(end) - Number(start);
  if (diff < 1000) return `${diff}ms`;
  const sec = (diff / 1000).toFixed(1);
  return `${sec}s`;
}
