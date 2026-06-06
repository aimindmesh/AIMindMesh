import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, Clock, RefreshCw, Activity, CheckCircle2, Server, Cloud } from 'lucide-react';
import { adminApi } from '../services/api';

interface StatItem {
  time: string;
  type: string;
  provider: string;
  status: string;
  count: number;
}

interface ExecutionHealth {
  summary: {
    status: string;
    count: number;
    avg_duration: number;
  }[];
  providers: {
    provider: string;
    count: number;
  }[];
  ingestionStats?: Record<string, number>;
}

export default function StatsView() {
  const [timeWindow, setTimeWindow] = useState<number>(24);
  const [stats, setStats] = useState<StatItem[]>([]);
  const [health, setHealth] = useState<ExecutionHealth | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, healthRes] = await Promise.all([
        adminApi.getTaskStats('hour', timeWindow),
        adminApi.getExecutionHealth(timeWindow)
      ]);
      setStats(statsRes.data.stats || []);
      setHealth(healthRes.data.health);
    } catch (e) {
      console.error('Failed to fetch stats', e);
    } finally {
      setIsLoading(false);
    }
  }, [timeWindow]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const aggregatedByTime = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; failed: number }>();
    stats.forEach(s => {
      const existing = map.get(s.time) || { total: 0, completed: 0, failed: 0 };
      existing.total += s.count;
      if (s.status === 'COMPLETED') existing.completed += s.count;
      if (s.status === 'FAILED') existing.failed += s.count;
      map.set(s.time, existing);
    });
    return Array.from(map.entries())
      .map(([time, data]) => ({ time, ...data }))
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 10); // Show last 10 on mobile
  }, [stats]);

  const maxCount = Math.max(...aggregatedByTime.map(d => d.total), 1);

  const totalTasks = health?.summary?.reduce((acc, curr) => acc + (curr.count || 0), 0) || 0;
  const successRate = Math.round((health?.summary?.find(s => s.status === 'COMPLETED')?.count || 0) / (totalTasks || 1) * 100);
  const avgLatency = ((health?.summary?.find(s => s.status === 'COMPLETED')?.avg_duration || 0) / 1000).toFixed(1);

  return (
    <div className="view-content animate-fade-in custom-scrollbar">
      {/* Header */}
      <header className="px-6 pt-2 pb-6 shrink-0">
        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
                    <BarChart3 className="text-primary" />
                    Analytics
                </h1>
                <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] mt-1">Real-time system health</p>
            </div>
            <button 
                onClick={fetchData}
                className={`p-3 rounded-2xl bg-surface border border-white/5 shadow-xl transition-all active:scale-90 ${isLoading ? 'opacity-50' : ''}`}
            >
                <RefreshCw size={20} className={isLoading ? 'animate-spin text-primary' : 'text-muted-foreground'} />
            </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 px-6 space-y-8 py-4 pb-40">
        
        {/* Quick Metrics */}
        <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface/50 border border-white/5 p-4 rounded-3xl flex flex-col items-center">
                <Activity size={14} className="text-primary opacity-50 mb-2" />
                <span className="text-xs font-black font-mono">{totalTasks}</span>
                <span className="text-[8px] font-black uppercase opacity-30 mt-1">Tasks</span>
            </div>
            <div className="bg-surface/50 border border-white/5 p-4 rounded-3xl flex flex-col items-center">
                <CheckCircle2 size={14} className="text-success opacity-50 mb-2" />
                <span className="text-xs font-black font-mono text-success">{successRate}%</span>
                <span className="text-[8px] font-black uppercase opacity-30 mt-1">Success</span>
            </div>
            <div className="bg-surface/50 border border-white/5 p-4 rounded-3xl flex flex-col items-center">
                <Clock size={14} className="text-warning opacity-50 mb-2" />
                <span className="text-xs font-black font-mono">{avgLatency}s</span>
                <span className="text-[8px] font-black uppercase opacity-30 mt-1">Latency</span>
            </div>
        </div>

        {/* Window Selector */}
        <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-2">Time Window</h3>
            <div className="flex items-center gap-2 bg-surface/50 p-1.5 rounded-[24px] border border-white/5">
                {[1, 6, 12, 24].map(h => (
                    <button 
                        key={h}
                        onClick={() => setTimeWindow(h)}
                        className={`flex-1 flex items-center justify-center py-3 rounded-2xl text-[10px] font-black uppercase transition-all ${timeWindow === h ? 'bg-secondary text-white shadow-lg' : 'text-muted-foreground'}`}
                    >
                        {h}h
                    </button>
                ))}
            </div>
        </div>

        {/* Chart Card */}
        <div className="bg-surface/30 border border-white/5 rounded-[40px] p-8 relative overflow-hidden group">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground mb-10">Execution Timeline</h3>
            <div className="h-48 flex items-end gap-3 mb-4 relative z-10">
                {aggregatedByTime.slice().reverse().map(d => (
                    <div key={d.time} className="flex-1 flex flex-col items-center gap-3 h-full">
                        <div className="flex-1 w-full flex flex-col justify-end gap-1">
                            <div 
                                style={{ height: `${(d.total / maxCount) * 100}%` }}
                                className="w-full bg-primary/20 rounded-t-full relative overflow-hidden"
                            >
                                <div 
                                    style={{ height: `${(d.completed / d.total) * 100}%` }}
                                    className="absolute bottom-0 left-0 w-full bg-primary rounded-t-full"
                                />
                            </div>
                        </div>
                        <span className="text-[8px] font-black text-muted-foreground/60 tracking-tighter">
                            {d.time.split(' ')[1]}
                        </span>
                    </div>
                ))}
            </div>
        </div>

        {/* Provider Split */}
        <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-2">Provider Split</h3>
            <div className="bg-surface/30 border border-white/5 rounded-[40px] p-8 space-y-6">
                {health?.providers?.map(p => {
                    const total = health.providers.reduce((acc, curr) => acc + curr.count, 0);
                    const percent = (p.count / total) * 100;
                    const isCloud = p.provider?.includes('API');
                    return (
                        <div key={p.provider} className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {isCloud ? <Cloud size={10} className="text-cyan-400" /> : <Server size={10} className="text-primary" />}
                                    <span className="text-[10px] font-black uppercase tracking-widest">{p.provider || 'UNKNOWN'}</span>
                                </div>
                                <span className="text-[10px] font-mono font-bold opacity-50">{Math.round(percent)}%</span>
                            </div>
                            <div className="h-1.5 bg-surface-hover/50 rounded-full overflow-hidden">
                                <div 
                                    className={`h-full rounded-full ${isCloud ? 'bg-cyan-400' : 'bg-primary'}`}
                                    style={{ width: `${percent}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Live Ingestion Ledger - NEW */}
        {health?.ingestionStats && (
            <div className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-2">Live Ledger</h3>
                <div className="bg-surface/30 border border-white/5 rounded-[40px] p-8">
                    <div className="grid grid-cols-2 gap-4">
                        {['pending', 'processing', 'indexing', 'done', 'error', 'skipped'].map((status) => {
                            // Check both lowercase and uppercase to be safe
                            const count = health.ingestionStats?.[status] || health.ingestionStats?.[status.toUpperCase()] || 0;
                            return (
                                <div key={status} className="bg-black/20 p-4 rounded-3xl border border-white/5">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[9px] font-black text-muted-foreground uppercase italic">{status}</span>
                                        {status === 'processing' && <Activity size={10} className="text-primary animate-pulse" />}
                                    </div>
                                    <span className={`text-xl font-black font-mono ${status === 'done' ? 'text-success' : status === 'error' ? 'text-error' : 'text-primary'}`}>
                                        {count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* Detailed Ledger Table */}
        <div className="space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground ml-2">Raw Ledger</h3>
            <div className="bg-surface/30 border border-white/5 rounded-[40px] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/5">
                                <th className="p-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Type</th>
                                <th className="p-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground">Provider</th>
                                <th className="p-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-center">Status</th>
                                <th className="p-4 text-[9px] font-black uppercase tracking-widest text-muted-foreground text-right">#</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {stats.slice(0, 15).map((s, idx) => (
                                <tr key={idx} className="active:bg-white/5 transition-colors">
                                    <td className="p-4">
                                        <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">{s.type}</span>
                                    </td>
                                    <td className="p-4">
                                        <span className="text-[10px] font-black uppercase tracking-tighter opacity-40">{s.provider || 'AUTO'}</span>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className={`w-1.5 h-1.5 rounded-full mx-auto ${s.status === 'COMPLETED' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-error'}`} />
                                    </td>
                                    <td className="p-4 text-right">
                                        <span className="text-[11px] font-black font-mono text-primary">{s.count}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
}
