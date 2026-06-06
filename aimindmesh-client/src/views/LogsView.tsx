import { useEffect, useState, useRef } from 'react';
import { Terminal, RefreshCw, Server, AlertCircle, Info, Bug, ShieldAlert, Copy, Check, Trash2, Zap, RefreshCcw, Activity } from 'lucide-react';
import { serverApi } from '../services/serverApi';
import { Logger } from '../utils/logger';
import { useVisibility } from '../hooks/useVisibility';
import { useUIStore } from '../store/uiStore';

interface SystemLog {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  module: string;
  message: string;
  metadata?: string;
  timestamp: number;
  // Extended properties for FCM/Sync logs
  status?: string;
  recipient?: string;
  direction?: string;
  device_id?: string;
  entity_type?: string;
  count?: number;
  error_msg?: string;
}

export default function LogsView() {
  const { performanceMode } = useUIStore();
  const { isDocumentVisible } = useVisibility();
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);
  const [moduleFilter, setModuleFilter] = useState(() => localStorage.getItem('ag_log_module_filter') || 'ALL');
  const [levelFilter, setLevelFilter] = useState(() => localStorage.getItem('ag_log_level_filter') || 'ALL');
  const [viewMode, setViewMode] = useState<'events' | 'raw'>('events');
  const [subView, setSubView] = useState<'TELEMETRY' | 'FCM' | 'SYNC'>('TELEMETRY');
  const [rawLogs, setRawLogs] = useState('');
  const autoScrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      if (viewMode === 'events') {
        let endpoint = '/api/admin/logs?limit=100';
        if (subView === 'FCM') endpoint = '/api/admin/fcm/logs?limit=100';
        if (subView === 'SYNC') endpoint = '/api/admin/sync/logs?limit=100';

        const res = await serverApi.get(endpoint);
        const serverLogs = res.data?.logs || [];
        
        if (subView === 'TELEMETRY') {
            const clientLogs = Logger.getPulses();
            const limit = performanceMode ? 80 : 150;
            const unified = [...serverLogs, ...clientLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
            setLogs(unified);
        } else {
            setLogs(serverLogs);
        }
      } else {
        const res = await serverApi.get('/api/admin/logs/raw?limit=500');
        setRawLogs(res.data);
      }
    } catch(e) {
      Logger.error('LogsView', 'Failed to synchronize neural telemetry', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLogs = () => {
    let text = '';
    if (viewMode === 'raw') {
        text = rawLogs;
    } else {
        if (logs.length === 0) return;
        text = logs.map(log => {
          const time = new Date(log.timestamp).toISOString();
          let out = `[${time}] [${log.level}] [${log.module}] ${log.message}`;
          if (log.metadata) out += `\nMetadata: ${log.metadata}`;
          return out;
        }).join('\n');
    }
    
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearLogs = async () => {
    if (!window.confirm("Are you sure you want to purge all system logs?")) return;
    try {
      setClearing(true);
      await serverApi.delete('/api/admin/logs');
      Logger.clearPulses();
      setLogs([]);
      Logger.info('LogsView', 'System log buffer purged successfully');
    } catch(e) {
      Logger.error('LogsView', 'Failed to purge system log buffer', e);
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    let interval: NodeJS.Timeout;
    if (autoRefresh && isDocumentVisible) {
      // Dynamic polling based on performance mode (20s vs 10s)
      const intervalMs = performanceMode ? 20000 : 10000;
      interval = setInterval(fetchLogs, intervalMs);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, viewMode, subView, isDocumentVisible]);

  useEffect(() => {
    localStorage.setItem('ag_log_module_filter', moduleFilter);
  }, [moduleFilter]);

  useEffect(() => {
    localStorage.setItem('ag_log_level_filter', levelFilter);
  }, [levelFilter]);

  useEffect(() => {
    if (autoScrollRef.current) {
        if (viewMode === 'events') {
            autoScrollRef.current.scrollTop = 0; 
        } else {
            autoScrollRef.current.scrollTop = autoScrollRef.current.scrollHeight;
        }
    }
  }, [logs, rawLogs, viewMode]);

  const getLogIcon = (level: string) => {
    switch(level) {
      case 'ERROR': return <ShieldAlert className="w-4 h-4 text-red-500" />;
      case 'WARN': return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      case 'DEBUG': return <Bug className="w-4 h-4 text-emerald-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const getLogColor = (level: string) => {
    switch(level) {
      case 'ERROR': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'WARN': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'DEBUG': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      default: return 'text-slate-300 bg-slate-800/40 border-slate-700/50';
    }
  };

  return (
    <div className="flex flex-col h-full bg-background/50 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-[100px] -z-10 animate-pulse pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
      
      {/* Header */}
      <header className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent flex items-center gap-3">
            <Terminal className="w-8 h-8 text-primary" />
            System Console
          </h1>
          <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm font-medium">
            <Server className="w-4 h-4" /> Live telemetry from Server
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex p-1 bg-surface/50 rounded-xl border border-border shadow-inner mr-2">
            <button 
                onClick={() => setViewMode('events')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all ${viewMode === 'events' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
                Events
            </button>
            <button 
                onClick={() => setViewMode('raw')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all ${viewMode === 'raw' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
                Stdout
            </button>
          </div>

          {viewMode === 'events' && (
            <>
              <select 
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value)}
                className="bg-surface/50 px-3 py-2 rounded-xl border border-border text-xs font-bold uppercase outline-none focus:ring-1 focus:ring-primary transition-all"
              >
                <option value="ALL">All Modules</option>
                {Array.from(new Set(logs.map(l => l.module))).sort().map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              <select 
                value={levelFilter}
                onChange={e => setLevelFilter(e.target.value)}
                className="bg-surface/50 px-3 py-2 rounded-xl border border-border text-xs font-bold uppercase outline-none focus:ring-1 focus:ring-primary transition-all"
              >
                <option value="ALL">All Levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </>
          )}

          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer bg-surface/50 px-4 py-2 rounded-xl border border-white/5 shadow-sm hover:bg-surface transition-colors">
            <input 
              type="checkbox" 
              checked={autoRefresh} 
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded border-white/10 bg-black/20 text-primary focus:ring-primary focus:ring-offset-0"
            />
            Auto-Tail
          </label>

          <button 
            onClick={handleClearLogs}
            disabled={clearing || logs.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-error/20 bg-error/10 text-error hover:bg-error/20 transition-all active:scale-95 disabled:opacity-50"
            title="Purge all logs"
          >
            <Trash2 className={`w-4 h-4 ${clearing ? 'animate-pulse' : ''}`} />
            <span className="text-xs font-bold uppercase tracking-wider">Flush Buffer</span>
          </button>

          <button 
            onClick={handleCopyLogs}
            disabled={logs.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${copied ? 'bg-success/20 border-success/40 text-success' : 'bg-surface border-white/5 text-muted-foreground hover:text-foreground'}`}
            title="Copy logs to clipboard"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span className="text-xs font-bold uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button 
            onClick={fetchLogs}
            disabled={loading}
            className="p-2 bg-primary/10 text-primary hover:bg-primary/20 hover:scale-105 active:scale-95 transition-all rounded-xl border border-primary/20 shadow-lg shadow-primary/5 disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Sub-View Tabs */}
      <div className="flex gap-4 px-8 mb-4">
        {[
          { id: 'TELEMETRY', label: 'Neural Telemetry', Icon: Activity },
          { id: 'FCM',       label: 'Synaptic Pulses',  Icon: Zap },
          { id: 'SYNC',      label: 'Knowledge Mesh',   Icon: RefreshCcw },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSubView(t.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all ${
              subView === t.id 
                ? 'bg-primary/20 border-primary/40 text-primary shadow-[0_0_20px_rgba(79,143,247,0.15)]' 
                : 'bg-surface/30 border-white/5 text-muted-foreground hover:bg-surface/50'
            }`}
          >
            <t.Icon className={`w-4 h-4 ${subView === t.id ? 'animate-pulse' : ''}`} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Logs Viewport */}
      <main className="flex-1 overflow-hidden px-8 pb-8 pt-4">
        <div 
          ref={autoScrollRef}
          className="h-full bg-[#0a0f18]/80 backdrop-blur-xl rounded-2xl border border-white/10 p-4 font-mono text-sm overflow-y-auto shadow-2xl custom-scrollbar relative"
        >
          {viewMode === 'raw' ? (
            <div className="whitespace-pre-wrap text-[12px] leading-tight text-slate-300">
                {rawLogs || 'Awaiting raw terminal stream...'}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
              <Terminal className="w-12 h-12 opacity-50" />
              <p>Awaiting central nervous system bursts...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {logs
                .filter(log => subView !== 'TELEMETRY' || (moduleFilter === 'ALL' || log.module === moduleFilter) && (levelFilter === 'ALL' || log.level === levelFilter))
                .map(log => {
                  if (subView === 'TELEMETRY') {
                    return (
                      <div 
                        key={log.id} 
                        className={`p-3 rounded-lg border flex gap-4 transition-all hover:bg-white/5 ${getLogColor(log.level)}`}
                      >
                        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                          {getLogIcon(log.level)}
                          <span className="text-[10px] font-bold tracking-wider opacity-70">
                            {log.level}
                          </span>
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-slate-400 shrink-0">
                              [{log.module}]
                            </span>
                            <span className="text-xs text-slate-500 opacity-60 tabular-nums">
                              {new Date(log.timestamp).toISOString().split('T')[1].slice(0,-1)}
                            </span>
                          </div>
                          <p className="break-words font-medium leading-relaxed tracking-wide text-slate-200">
                            {log.message}
                          </p>
                          {log.metadata && (
                            <pre className="mt-2 text-xs bg-black/40 p-3 rounded-md overflow-x-auto text-slate-400 border border-white/5">
                              {log.metadata}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  } else if (subView === 'FCM') {
                    const isSuccess = log.status === 'SUCCESS';
                    return (
                      <div 
                        key={log.id} 
                        className={`p-3 rounded-lg border flex gap-4 transition-all hover:bg-white/5 ${isSuccess ? 'bg-primary/5 border-primary/20 text-slate-200' : 'bg-error/5 border-error/20 text-slate-200'}`}
                      >
                        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                          <Zap className={`w-4 h-4 ${isSuccess ? 'text-primary' : 'text-error'}`} />
                          <span className={`text-[10px] font-bold tracking-wider ${isSuccess ? 'text-primary' : 'text-error'}`}>
                            {log.status}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-slate-400">TO: {log.recipient}</span>
                              <span className="text-xs text-slate-500 opacity-60 tabular-nums">{new Date(log.timestamp).toLocaleTimeString()}</span>
                           </div>
                           <p className="font-medium">{log.message}</p>
                        </div>
                      </div>
                    );
                  } else { // SYNC
                    const isSuccess = log.status === 'SUCCESS';
                    return (
                      <div 
                        key={log.id} 
                        className={`p-3 rounded-lg border flex gap-4 transition-all hover:bg-white/5 ${isSuccess ? 'bg-primary/5 border-primary/20 text-slate-200' : 'bg-error/5 border-error/20 text-slate-200'}`}
                      >
                        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                          <RefreshCcw className={`w-4 h-4 ${isSuccess ? 'text-primary' : 'text-error'}`} />
                          <span className={`text-[10px] font-bold tracking-wider ${isSuccess ? 'text-primary' : 'text-error'}`}>
                            {log.direction}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-semibold text-slate-400">NODE: {log.device_id}</span>
                              <span className="text-xs text-slate-500 opacity-60 tabular-nums">{new Date(log.timestamp).toLocaleTimeString()}</span>
                           </div>
                           <div className="flex items-center gap-4">
                              <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] font-black uppercase tracking-widest text-primary">{log.entity_type}</span>
                              <span className="text-xs font-medium text-slate-300">{log.count} records processed</span>
                           </div>
                           {log.error_msg && <p className="mt-2 text-xs text-error font-medium italic">{log.error_msg}</p>}
                        </div>
                      </div>
                    );
                  }
                })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
