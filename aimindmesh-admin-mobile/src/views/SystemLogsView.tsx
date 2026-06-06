import { useEffect, useRef, useCallback } from 'react';
import { RefreshCw, X, Filter, Activity, Zap, RefreshCcw } from 'lucide-react';
import { useLogsStore } from '../store/logsStore';

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-error',
  WARN:  'text-warning',
  INFO:  'text-foreground/80',
  DEBUG: 'text-muted-foreground',
};

export default function SystemLogsView() {
  const { 
    logs, isLoading, activeTab, moduleFilter, levelFilter, 
    availableModules, availableLevels, fetch, 
    setModuleFilter, setLevelFilter, setActiveTab, clear 
  } = useLogsStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef  = useRef<NodeJS.Timeout | null>(null);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => { await fetch(); startPolling(); }, 30000);
  }, [fetch]);

  useEffect(() => {
    fetch().then(startPolling);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [moduleFilter, levelFilter]);

  return (
    <div className="view-content flex flex-col h-full !overflow-hidden">
      {/* Header */}
      <div className="flex flex-col border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div>
            <h1 className="text-lg font-black tracking-tighter italic">SYNAPTIC PULSE</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{logs.length} entries • {activeTab}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={clear} className="p-2.5 rounded-xl bg-surface border border-border active:scale-90 transition-all">
              <X size={14} className="text-muted-foreground" />
            </button>
            <button onClick={fetch} className="p-2.5 rounded-xl bg-surface border border-border active:scale-90 transition-all">
              <RefreshCw size={14} className={`text-primary ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-1 px-4 pb-3">
          {[
            { id: 'SYSTEM', label: 'Telemetry', Icon: Activity },
            { id: 'FCM',    label: 'Push',      Icon: Zap },
            { id: 'SYNC',   label: 'Sync',      Icon: RefreshCcw },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                activeTab === t.id 
                  ? 'bg-primary/20 border-primary/40 text-primary' 
                  : 'bg-surface/50 border-border/30 text-muted-foreground'
              }`}
            >
              <t.Icon size={12} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Module Filter - Only for SYSTEM */}
      {activeTab === 'SYSTEM' && (
        <div className="flex gap-2 px-4 py-3 overflow-x-auto shrink-0 border-b border-border/30" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex items-center gap-1 shrink-0 mr-1">
            <Filter size={10} className="text-muted-foreground" />
          </div>
          {/* Level filters */}
          {availableLevels.map(l => (
            <button
              key={l}
              onClick={() => setLevelFilter(levelFilter === l ? null : l)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 ${
                levelFilter === l
                  ? l === 'ERROR' ? 'bg-error/20 border-error/40 text-error'
                    : l === 'WARN' ? 'bg-warning/20 border-warning/40 text-warning'
                    : 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-surface border-border text-muted-foreground'
              }`}
            >
              {l}
            </button>
          ))}
          <div className="w-px bg-border/50 shrink-0 mx-1" />
          {/* Module filters */}
          {availableModules.map(m => (
            <button
              key={m}
              onClick={() => setModuleFilter(moduleFilter === m ? null : m)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border transition-all active:scale-95 ${
                moduleFilter === m
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-surface border-border text-muted-foreground'
              }`}
            >
              {m.replace('Engine','').replace('Service','').replace('Router','')}
            </button>
          ))}
        </div>
      )}

      {/* Log Lines */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-30 gap-3">
            <p className="text-xs font-black uppercase tracking-widest">No Logs</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {logs.map((log, idx) => {
              if (activeTab === 'SYSTEM') {
                return (
                  <div key={log.id || idx} className="p-3 bg-surface/30 border border-border/20 rounded-2xl flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider opacity-60">
                      <div className="flex items-center gap-2">
                        <span className={LEVEL_COLORS[log.level] || 'text-muted-foreground'}>[{log.level}]</span>
                        <span className="text-muted-foreground">@{log.module}</span>
                      </div>
                      <span>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className={`text-[11px] leading-relaxed break-words whitespace-pre-wrap font-medium ${LEVEL_COLORS[log.level] || 'text-foreground/80'}`}>
                      {log.message}
                    </div>
                  </div>
                );
              } else if (activeTab === 'FCM') {
                const isSuccess = log.status === 'SUCCESS';
                return (
                  <div key={log.id || idx} className="p-3 bg-surface/30 border border-border/20 rounded-2xl flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider opacity-60">
                      <div className="flex items-center gap-2">
                        <span className={isSuccess ? 'text-primary' : 'text-error'}>[{log.status}]</span>
                        <span className="text-muted-foreground">{log.recipient}</span>
                      </div>
                      <span>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[11px] font-medium text-foreground/80 break-words">
                      {log.message}
                    </div>
                  </div>
                );
              } else { // SYNC
                const isSuccess = log.status === 'SUCCESS';
                return (
                  <div key={log.id || idx} className="p-3 bg-surface/30 border border-border/20 rounded-2xl flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider opacity-60">
                      <div className="flex items-center gap-2">
                        <span className={isSuccess ? 'text-primary' : 'text-error'}>[{log.direction}]</span>
                        <span className="text-muted-foreground">{log.device_id.substring(0, 8)}...</span>
                      </div>
                      <span>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                       <div className="text-[11px] font-bold text-foreground/90 uppercase tracking-tight">
                         {log.entity_type}
                       </div>
                       <div className="text-[10px] font-black text-primary px-2 py-0.5 rounded-full bg-primary/10">
                         {log.count} ITEMS
                       </div>
                    </div>
                    {log.error_msg && (
                      <div className="text-[10px] text-error font-medium italic mt-1 break-words">
                        {log.error_msg}
                      </div>
                    )}
                  </div>
                );
              }
            })}
          </div>
        )}
      </div>
    </div>
  );
}
