import { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, ListTodo, BrainCircuit, BellRing, Download, Layers, ShieldCheck, Cpu, HardDrive, Zap, BookOpen, Database, BarChart3, XCircle } from 'lucide-react';
import { serverApi, releaseApi, ReleaseInfo, adminApi } from '../services/serverApi';
import { useNodeStore } from '../store/nodeStore';
import { useAiTaskStore } from '../store/aiTaskStore';
import { Logger, LogLevel } from '../utils/logger';
import { OpenClawStatusBadge } from '../components/openclaw/OpenClawStatusBadge';
import { useVisibility } from '../hooks/useVisibility';

import { useUIStore } from '../store/uiStore';

// Sub-components
import { AdminOverview } from '../components/admin/AdminOverview';
import { SynthesisController } from '../components/admin/SynthesisController';
import { NotificationCenter } from '../components/admin/NotificationCenter';
import { ReleaseManager } from '../components/admin/ReleaseManager';
import { TaskOrchestrator } from '../components/admin/TaskOrchestrator';
import { BackupManagement } from '../components/admin/BackupManagement';
import { StatisticsView } from '../components/admin/StatisticsView';
import { QuarantineView } from '../components/admin/QuarantineView';

interface ServerNode {
  id: string; type: string; status: string; url: string; models?: string[]; last_heartbeat?: number; version?: string; address?: string;
}

interface ServerStatus {
  nodes: ServerNode[]; geminiUsage: number; openrouterUsage: number; cpu: number; ram: { total: string; used: string; percent: number }; fcmStatus?: boolean; dailyQuotaCap?: number; openrouterDailyQuotaCap?: number; coreCount?: number;
  infrastructureBrake: boolean;
  openClawHealth?: {
    isHealthy: boolean;
    statusMessage: string;
    lastCheck: number;
  };
  openrouterCredits?: {
    balance: number;
    total_usage: number;
    total_credits: number;
    lastChecked: number;
  } | null;
}

interface ServerConfig {
  proactive?: { enabled: boolean; intervalHours?: number; relevanceThreshold?: number; quietHoursStart?: string; quietHoursEnd?: string; };
  delivery?: { quietHours: boolean; quietStart: string; quietEnd: string; };
  gemini?: { model?: string; apiKey?: string; dailyQuotaCap?: number; };
  openrouter?: { model?: string; apiKey?: string; dailyQuotaCap?: number; creditCheckIntervalHours?: number; lowCreditThreshold?: number; };
  freellmapi?: { enabled?: boolean; baseUrl?: string; apiKey?: string; model?: string; timeoutMs?: number; };
  ollama?: { baseUrl: string; defaultModel: string; embeddingModel: string; timeoutMs?: number; numThread?: number; numCtx?: number; keepAlive?: string; };
  routing?: { preferredNode: string; };
  logging?: { level: LogLevel; };
  debate?: { threadMerging?: boolean; participants?: { name: string; persona: string }[]; };
}

type TabType = 'overview' | 'proactive' | 'quarantine' | 'statistics' | 'fcm' | 'ai-tasks' | 'wiki' | 'releases' | 'backup';

export default function AdminPanel() {
  const { performanceMode, setPerformanceMode } = useUIStore();
  const { isDocumentVisible } = useVisibility();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);

  const [cycleLogs, setCycleLogs] = useState<any[]>([]);
  const [fcmLogs, setFcmLogs] = useState<any[]>([]);
  const [releases, setReleases] = useState<{ pc?: ReleaseInfo; android?: ReleaseInfo } | null>(null);
  const [activeActivity, setActiveActivity] = useState<any[]>([]);
  const [queueHistory, setQueueHistory] = useState<any[]>([]);
  const [failedHistory, setFailedHistory] = useState<any[]>([]);
  const [wikiInfo, setWikiInfo] = useState<{ count: number; log: string } | null>(null);
  
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [availableServerModels, setAvailableServerModels] = useState<string[]>([]);
  const [openRouterModels, setOpenRouterModels] = useState<any[]>([]);

  const nodeStatus = useNodeStore(state => state.status);
  const ollamaRunning = useNodeStore(state => state.ollamaRunning);
  const updateServerStatus = useNodeStore(state => state.updateServerStatus);
  const loadTasks = useAiTaskStore(state => state.loadTasks);

  const isPollingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const statusRes = await serverApi.get('/api/admin/status');
      const mappedNodes = (statusRes.data.nodes || []).map((n: any) => ({ 
        ...n, 
        url: n.url || n.ollama_url || n.baseUrl || 'internal',
        address: n.address || n.url || n.ollama_url || n.baseUrl || '10.2.0.1'
      }));
      
      setStatus(prev => {
        // Deep compare prevention: only update if core metrics changed
        if (prev && 
            prev.cpu === statusRes.data.cpu && 
            prev.ram.percent === statusRes.data.ram?.percent &&
            prev.nodes.length === mappedNodes.length) {
          return prev;
        }
        return { 
          ...statusRes.data, 
          nodes: mappedNodes, 
          cpu: statusRes.data.cpu || 0, 
          ram: statusRes.data.ram || { total: '0GB', used: '0GB', percent: 0 },
          dailyQuotaCap: statusRes.data.dailyQuotaCap || 10000000,
          openrouterDailyQuotaCap: statusRes.data.openrouterDailyQuotaCap || 10000000,
          openClawHealth: statusRes.data.openClawHealth
        };
      });

      const serverNode = mappedNodes.find((n: any) => n.id === 'SERVER_LOCAL' || n.type === 'server');
      const isOllamaUp = !!serverNode && serverNode.status === 'ONLINE';

      updateServerStatus({
        status: 'ONLINE',
        ollamaRunning: isOllamaUp,
        ollamaModel: serverNode?.models?.[0] || null,
        geminiCallsUsed: statusRes.data.geminiUsage || 0,
        geminiCallsCap: statusRes.data.dailyQuotaCap || 10000000
      });

      if (serverNode?.models) setAvailableServerModels(serverNode.models);
    } catch (err) { Logger.error('AdminPanel', 'Telemetry sync loss'); }
  }, [updateServerStatus]);

  const fetchConfig = useCallback(async () => {
    try {
      const configRes = await serverApi.get('/api/admin/config');
      setConfig(configRes.data.config);
    } catch (err) { Logger.error('AdminPanel', 'Configuration link broken'); }
  }, []);

  const fetchTabData = useCallback(async () => {
    try {
      if (activeTab === 'proactive') {
        const [logsRes, activityRes, historyRes, failedRes] = await Promise.all([
          serverApi.get('/api/admin/logs?limit=50&module=ProactiveEngine,DebateEngine,InferenceRouter,SearchService,InferenceRegistry'),
          serverApi.get('/api/admin/activity?limit=20'),
          adminApi.getQueueHistory(40, 'COMPLETED'),
          adminApi.getQueueHistory(100, 'FAILED')
        ]);
        setCycleLogs(logsRes.data.logs || []);
        setActiveActivity(activityRes.data.activeInferences || activityRes.data.activity || []);
        setQueueHistory(historyRes.data.history || []);
        setFailedHistory(failedRes.data.history || []);
      } else if (activeTab === 'quarantine') {
        const res = await adminApi.getQueueHistory(100, 'FAILED');
        setFailedHistory(res.data.history || []);
      } else if (activeTab === 'fcm') {
        const res = await serverApi.get('/api/admin/fcm/logs?limit=40');
        setFcmLogs(res.data.logs || []);
      } else if (activeTab === 'releases') {
        const res = await releaseApi.getVersions();
        setReleases(res.data.versions);
      } else if (activeTab === 'ai-tasks') {
        loadTasks();
      } else if (activeTab === 'wiki') {
        const [pagesRes, logRes] = await Promise.allSettled([
          serverApi.get('/api/wiki'),
          serverApi.get('/api/wiki/log?n=20')
        ]);
        const count = pagesRes.status === 'fulfilled' ? (pagesRes.value.data.count ?? 0) : 0;
        const log = logRes.status === 'fulfilled' ? (logRes.value.data.log ?? '') : 'Log unavailable.';
        setWikiInfo({ count, log });
      } else if (activeTab === 'overview') {
        const [modelsRes, creditsRes] = await Promise.all([
          serverApi.get('/api/admin/openrouter/models'),
          serverApi.get('/api/admin/openrouter/credits')
        ]);
        setOpenRouterModels(modelsRes.data.models || []);
        setStatus(prev => prev ? { ...prev, openrouterCredits: creditsRes.data.credits } : null);
      }
    } catch (err) { Logger.error('AdminPanel', `Cluster sync failure in ${activeTab}`); }
  }, [activeTab, loadTasks]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isMounted = true;

    const poll = async () => {
      if (!isDocumentVisible || !isMounted || isSaving || isSaved || isPollingRef.current) {
        if (isMounted) timeoutId = setTimeout(poll, 5000); 
        return;
      }
      
      isPollingRef.current = true;
      try {
        await Promise.all([fetchStatus(), fetchTabData()]);
      } catch (e) {
        Logger.error('AdminPanel', 'Poll synchronization failure');
      } finally {
        isPollingRef.current = false;
        if (isMounted) {
          timeoutId = setTimeout(poll, performanceMode ? 20000 : 12000);
        }
      }
    };

    // Initial load - consolidated for stability
    const init = async () => {
      if (!isMounted || isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        await Promise.all([fetchStatus(), fetchConfig()]);
        await fetchTabData();
      } catch (e) {
        Logger.error('AdminPanel', 'Initial cockpit sync failed');
      } finally {
        isPollingRef.current = false;
        if (isMounted) {
          setIsLoading(false);
          if (!timeoutId) timeoutId = setTimeout(poll, performanceMode ? 15000 : 8000);
        }
      }
    };

    init();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [activeTab, isDocumentVisible]);

  const handleConfigSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await serverApi.patch('/api/admin/config', config);
      await fetchConfig(); // TARGETED SYNC: only config, status is handled by poll
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) { Logger.error('AdminPanel', 'Configuration commit rejected by server'); }
    finally { setIsSaving(false); }
  };
  
  const handleToggleBrake = async (active: boolean) => {
    try {
      await serverApi.post('/api/admin/maintenance/brake', { active });
      await fetchStatus();
    } catch (err) {
      Logger.error('AdminPanel', 'Failed to toggle infrastructure brake');
    }
  };

  const onUpdateConfigCallback = useCallback((p: any) => {
    setConfig(prev => prev ? { ...prev, ...p } : p);
  }, []);

  const onRefreshCallback = useCallback(() => {
    fetchStatus();
    fetchConfig();
  }, [fetchStatus, fetchConfig]);

  const tabs: {id: TabType; name: string; icon: any}[] = [
    { id: 'overview', name: 'INFRASTRUCTURE', icon: ShieldCheck },
    { id: 'proactive', name: 'BRAIN CORE', icon: BrainCircuit },
    { id: 'quarantine', name: 'QUARANTINE', icon: XCircle },
    { id: 'statistics', name: 'ANALYTICS', icon: BarChart3 },
    { id: 'fcm', name: 'NEURAL PUSH', icon: BellRing },
    { id: 'ai-tasks', name: 'EXECUTION', icon: ListTodo },
    { id: 'wiki', name: 'NEURAL WIKI', icon: BookOpen },
    { id: 'backup', name: 'DATABASE RECOVERY', icon: Database },
    { id: 'releases', name: 'DISTRIBUTION', icon: Download },
  ];



  const onPruneCallback = useCallback(() => {
    serverApi.delete('/api/admin/nodes/prune').then(fetchStatus);
  }, [fetchStatus]);

  const onRefreshNodesCallback = useCallback(() => {
    serverApi.post('/api/admin/nodes/refresh').then(fetchStatus);
  }, [fetchStatus]);

  return (
    <div className={`p-6 min-h-screen flex flex-col gap-10 max-w-[1700px] mx-auto w-full overflow-y-auto custom-scrollbar ${performanceMode ? 'perf-mode' : ''} bg-background`}>
      
      {/* RESTORED MASTER HEADER (1:1 FEATURE PARITY) */}
      <div className="flex flex-col gap-6 sticky top-0 z-30 bg-background/98 py-6 border-b border-white/5 -mx-6 px-12 mb-2 shadow-2xl">
        <div className="flex items-center justify-between w-full">
          <h1 className="text-4xl font-black tracking-tighter flex items-center gap-5 italic group cursor-pointer" onClick={onRefreshCallback}>
            <Layers className="w-10 h-10 text-primary group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(79,143,247,0.4)]" /> CORE CONSOLE
          </h1>
          
          <div className="flex items-center gap-6">
            {/* UNIFIED INFRASTRUCTURE METRICS BAR */}
            <div className="hidden lg:flex items-center gap-6 bg-surface border border-border p-2.5 px-8 rounded-2xl shadow-inner">
               <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title="Compute Load">
                  <Cpu size={14} className="text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[11px] font-black uppercase tracking-widest font-mono">CPU: {status?.cpu || 0}%</span>
               </div>
               
               <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title="Memory Allocation">
                  <HardDrive size={14} className="text-success opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[11px] font-black uppercase tracking-widest font-mono">RAM: {status?.ram.percent || 0}%</span>
               </div>
               
               <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title="Local Ollama Inference Engine">
                  <div className={`w-2 h-2 rounded-full ${ollamaRunning ? 'status-dot-online' : 'status-dot-offline'}`} />
                  <span className={`text-[11px] font-black uppercase tracking-widest ${ollamaRunning ? 'text-success' : 'text-error'}`}>
                    Ollama: {ollamaRunning ? 'ONLINE' : 'OFFLINE'}
                  </span>
               </div>

               <OpenClawStatusBadge minimal />

               <div className="flex items-center gap-3 pr-6 border-r border-border group cursor-help" title="Mesh Network Status">
                  <div className={`w-2 h-2 rounded-full ${nodeStatus === 'ONLINE' ? 'status-dot-online' : 'status-dot-offline'}`} />
                  <span className="text-[11px] font-black uppercase tracking-widest text-foreground/80">NODE: {nodeStatus}</span>
               </div>

               <div className="flex items-center gap-3 group cursor-help" title="Gemini Daily Pulse Quota">
                  <Zap size={14} className="text-warning opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span className="text-[11px] font-black uppercase tracking-widest font-mono">GATEWAY: {status?.dailyQuotaCap ? Math.round((status.geminiUsage / status.dailyQuotaCap) * 100) : 0}%</span>
               </div>
            </div>
            
            <button 
              onClick={() => setPerformanceMode(!performanceMode)} 
              className={`text-[11px] font-black uppercase tracking-[0.25em] px-8 py-4 rounded-2xl shadow-xl transition-all active:scale-95 border-b-4 border-black/20 ${performanceMode ? 'bg-warning text-white' : 'bg-surface text-muted-foreground hover:text-foreground'}`}
              title="Toggle Performance Mode (Disables heavy blur and 3D effects)"
            >
              {performanceMode ? 'PERF-MODE ON' : 'PERF-MODE OFF'}
            </button>

            <button onClick={handleConfigSave} disabled={isSaving} className={`text-[11px] font-black uppercase tracking-[0.25em] px-12 py-4 rounded-2xl shadow-2xl transition-all active:scale-95 border-b-4 border-black/20 ${isSaved ? 'bg-success text-white' : 'bg-primary text-white hover:bg-primary-hover shadow-primary/30 hover:-translate-y-1'}`}>
              {isSaving ? 'SYNCING...' : isSaved ? 'COMMITTED ✓' : 'COMMIT CHANGES'}
            </button>
          </div>
        </div>

        {/* RESTORED HIGH-CONTRAST TAB BAR (CRITICAL VISIBILITY) */}
        <div className="flex flex-wrap items-center justify-center bg-surface-hover/60 p-3 rounded-[40px] border border-border w-full font-black shadow-inner gap-3">
          {tabs.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)} 
              className={`px-6 py-3.5 rounded-[24px] transition-all capitalize text-[10px] flex items-center gap-3 tracking-[0.15em] min-w-[160px] justify-center border-2 relative ${activeTab === tab.id ? 'bg-surface text-primary border-primary/40 shadow-xl scale-105' : 'text-foreground/80 border-transparent hover:bg-surface/50'}`}
            >
              <tab.icon size={16} className={activeTab === tab.id ? 'text-primary' : 'opacity-40'} />
              {tab.name}
              {tab.id === 'quarantine' && failedHistory.length > 0 && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-error text-white rounded-full flex items-center justify-center text-[10px] animate-bounce shadow-lg border-2 border-background">
                  {failedHistory.length}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 flex flex-col gap-16 pb-32">
        {/* INLINE STATUS OVERLAYS (RESOLVES BLANK SCREEN) */}
        {isLoading && !status && (
           <div className="flex-1 flex flex-col items-center justify-center p-20 opacity-50 min-h-[400px]">
              <Activity className="w-12 h-12 text-primary animate-pulse mb-6" />
              <p className="text-sm font-black uppercase tracking-[0.4em] animate-pulse italic text-center">Initializing Neural Cockpit...</p>
           </div>
        )}

        {!status && !isLoading && (
           <div className="flex-1 flex flex-col items-center justify-center p-20 text-error min-h-[400px]">
              <ShieldCheck className="w-12 h-12 mb-6 opacity-40" />
              <p className="text-sm font-black uppercase tracking-[0.4em] mb-4 text-center">Telemetry Stream Offline</p>
              <button onClick={onRefreshCallback} className="px-10 py-4 bg-surface border border-border rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-surface-hover transition-colors">Reconnect Pulse</button>
           </div>
        )}
        {activeTab === 'overview' && status && (
          <AdminOverview 
            status={status} 
            isLoading={isLoading} 
            config={config}
            onUpdateConfig={onUpdateConfigCallback}
            onToggleBrake={handleToggleBrake}
            availableModels={availableServerModels}
            openRouterModels={openRouterModels}
            onRefresh={onRefreshCallback} 
            onPrune={onPruneCallback} 
            onRefreshNodes={onRefreshNodesCallback} 
          />
        )}

        {activeTab === 'proactive' && (
          <SynthesisController 
            config={config} 
            onUpdateConfig={onUpdateConfigCallback}
            onTriggerProactive={() => { setIsTriggering(true); serverApi.post('/api/admin/proactive/trigger').finally(() => { setIsTriggering(false); fetchTabData(); }); }}
            onTriggerReprocess={() => { setIsTriggering(true); serverApi.post('/api/admin/debate/reprocess', { limit: 20 }).finally(() => { setIsTriggering(false); fetchTabData(); }); }}
            onTriggerMerge={() => { setIsTriggering(true); serverApi.post('/api/admin/debate/merge').finally(() => { setIsTriggering(false); fetchTabData(); }); }}
            onRefreshTabData={fetchTabData}
            logs={cycleLogs}
            activity={activeActivity}
            history={queueHistory}
            isTriggering={isTriggering}
            availableModels={availableServerModels}
            nodes={status?.nodes || []}
          />
        )}

        {activeTab === 'statistics' && (
          <StatisticsView />
        )}
        
        {activeTab === 'quarantine' && (
          <QuarantineView tasks={failedHistory} onRefresh={fetchTabData} />
        )}

        {activeTab === 'fcm' && (
          <NotificationCenter status={status} fcmLogs={fcmLogs} onTestNotification={(t: any) => serverApi.post('/api/admin/fcm/test', { token: t })} config={config} onUpdateConfig={onUpdateConfigCallback} />
        )}


        {activeTab === 'releases' && (
          <ReleaseManager releases={releases} />
        )}

        {activeTab === 'ai-tasks' && (
          <TaskOrchestrator />
        )}
        

        {activeTab === 'wiki' && (
          <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
              <BookOpen className="w-7 h-7 text-primary" />
              <div>
                <h2 className="text-2xl font-black tracking-tight italic">Neural Wiki</h2>
                <p className="text-xs text-muted-foreground">Autonomous knowledge compilation engine</p>
              </div>
            </div>

            {/* Status card */}
            <div className="grid grid-cols-3 gap-4">
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/60">Compiled Pages</span>
                <span className="text-3xl font-black text-primary">{wikiInfo?.count ?? '—'}</span>
              </div>
              <div className="glass-panel rounded-2xl p-5 flex flex-col gap-2 col-span-2">
                <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/60">Quick Actions</span>
                <div className="flex gap-3">
                  <button
                    id="admin-wiki-run-cycle"
                    onClick={() => { setIsTriggering(true); serverApi.post('/api/wiki/run-cycle').finally(() => { setIsTriggering(false); fetchTabData(); }); }}
                    disabled={isTriggering}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-xs font-black uppercase tracking-widest hover:bg-primary-hover transition-all disabled:opacity-40 shadow-lg shadow-primary/20"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {isTriggering ? 'Running…' : 'Run Cycle Now'}
                  </button>
                  <button
                    onClick={() => fetchTabData()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface border border-border text-xs font-black uppercase tracking-widest hover:bg-surface-hover transition-all"
                  >
                    Refresh Status
                  </button>
                </div>
              </div>
            </div>

            {/* Log viewer */}
            <div className="glass-panel rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-[10px] uppercase tracking-widest font-black text-muted-foreground/60">Recent Activity Log</span>
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap bg-background/50 rounded-xl p-4 border border-border max-h-80 overflow-y-auto custom-scrollbar">
                {wikiInfo?.log || 'No log entries yet. Run a synthesis cycle to generate content.'}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'backup' && (
          <BackupManagement />
        )}
      </main>
      
      {(status?.infrastructureBrake || !isDocumentVisible) && (
        <div className={`fixed bottom-10 right-10 px-8 py-4 border-2 rounded-3xl text-[11px] font-black uppercase tracking-[0.4em] animate-pulse z-50 shadow-[0_20px_60px_rgba(0,0,0,0.6)] ${status?.infrastructureBrake ? 'bg-error text-white border-white/20' : 'bg-[#1a1505] border-warning/40 text-warning'}`}>
          {status?.infrastructureBrake ? 'SYSTEM BRAKE ENGAGED' : 'INFRASTRUCTURE BRAKE ACTIVE'}
        </div>
      )}
    </div>
  );
}
