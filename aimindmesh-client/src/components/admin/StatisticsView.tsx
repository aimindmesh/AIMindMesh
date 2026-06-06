import { useEffect, useState, useMemo } from 'react';
import { BarChart3, TrendingUp, Activity, Server, Cloud, Clock, CheckCircle2, Calendar, Database } from 'lucide-react';
import { adminApi } from '../../services/serverApi';

interface TaskStat {
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

export function StatisticsView() {
  const [stats, setStats] = useState<TaskStat[]>([]);
  const [health, setHealth] = useState<ExecutionHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeUnit, setTimeUnit] = useState<'hour' | 'day'>('hour');
  const [timeWindow, setTimeWindow] = useState<number>(24);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, healthRes] = await Promise.all([
        adminApi.getTaskStats(timeUnit, timeWindow),
        adminApi.getExecutionHealth(timeWindow)
      ]);
      setStats(statsRes.data.stats || []);
      setHealth(healthRes.data.health);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Auto refresh every minute
    return () => clearInterval(interval);
  }, [timeUnit, timeWindow]);

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
      .slice(0, 24); // Last 24 entries
  }, [stats]);

  const providerDistribution = useMemo(() => {
    if (!health?.providers) return [];
    return health.providers.sort((a, b) => b.count - a.count);
  }, [health]);

  const maxCount = Math.max(...aggregatedByTime.map(d => d.total), 1);

  if (isLoading && !stats.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 opacity-50">
        <Activity className="w-12 h-12 text-primary animate-pulse" />
        <p className="text-xs font-black uppercase tracking-[0.4em] animate-pulse">Aggregating Synaptic Data...</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
      {/* Header & Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tighter italic uppercase flex items-center gap-3">
            <BarChart3 className="text-primary" />
            Core <span className="text-muted-foreground">Statistics</span>
          </h2>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">Real-time execution analytics & provider distribution</p>
        </div>
        
        <div className="flex gap-4">
          {/* Time Window Selector */}
          <div className="flex bg-surface-hover/30 p-1 rounded-xl border border-border/50">
            {[1, 6, 12, 24].map(h => (
              <button 
                key={h}
                onClick={() => setTimeWindow(h)}
                className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${timeWindow === h ? 'bg-secondary text-white shadow-lg' : 'hover:bg-white/5 text-muted-foreground'}`}
              >
                {h}h
              </button>
            ))}
          </div>

          <div className="flex bg-surface-hover/30 p-1 rounded-xl border border-border/50">
            <button 
              onClick={() => setTimeUnit('hour')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${timeUnit === 'hour' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'hover:bg-white/5 text-muted-foreground'}`}
            >
              Hourly
            </button>
            <button 
              onClick={() => setTimeUnit('day')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${timeUnit === 'day' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'hover:bg-white/5 text-muted-foreground'}`}
            >
              Daily
            </button>
          </div>
        </div>
      </div>

      {/* Top Metrics Row */}
      <div className="grid grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-3xl border border-border/50 hover:border-primary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2.5 bg-primary/10 rounded-2xl text-primary group-hover:scale-110 transition-transform">
              <Activity size={20} />
            </div>
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest italic">24h Throughput</span>
          </div>
          <p className="text-4xl font-black italic tracking-tighter mb-1">
            {health?.summary?.reduce((acc, curr) => acc + (curr.count || 0), 0) || 0}
          </p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Total Tasks Processed</p>
        </div>

        <div className="glass-panel p-6 rounded-3xl border border-border/50 hover:border-success/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2.5 bg-success/10 rounded-2xl text-success group-hover:scale-110 transition-transform">
              <CheckCircle2 size={20} />
            </div>
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest italic">Success Rate</span>
          </div>
          <p className="text-4xl font-black italic tracking-tighter mb-1 text-success">
            {Math.round((health?.summary?.find(s => s.status === 'COMPLETED')?.count || 0) / 
              (health?.summary?.reduce((acc, curr) => acc + (curr.count || 0), 0) || 1) * 100)}%
          </p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Execution Efficiency</p>
        </div>

        <div className="glass-panel p-6 rounded-3xl border border-border/50 hover:border-warning/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2.5 bg-warning/10 rounded-2xl text-warning group-hover:scale-110 transition-transform">
              <Clock size={20} />
            </div>
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest italic">Avg Latency</span>
          </div>
          <p className="text-4xl font-black italic tracking-tighter mb-1">
            {( (health?.summary?.find(s => s.status === 'COMPLETED')?.avg_duration || 0) / 1000 ).toFixed(1)}s
          </p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Per completed inference</p>
        </div>
        <div className="glass-panel p-6 rounded-3xl border border-border/50 hover:border-secondary/30 transition-all group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2.5 bg-secondary/10 rounded-2xl text-secondary group-hover:scale-110 transition-transform">
              <TrendingUp size={20} />
            </div>
            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest italic">Nodes Active</span>
          </div>
          <p className="text-4xl font-black italic tracking-tighter mb-1">
            {providerDistribution.length}
          </p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Participating providers</p>
        </div>
      </div>

      {/* Ingestion & Queue Health - NEW */}
      <div className="grid grid-cols-5 gap-4">
        {['pending', 'processing', 'indexing', 'vectorizing', 'done'].map((status) => {
          const count = health?.ingestionStats?.[status] || 0;
          const color = status === 'done' ? 'text-success' : 
                        status === 'pending' ? 'text-warning' : 
                        'text-primary';
          
          return (
            <div key={status} className="glass-panel p-4 rounded-2xl border border-border/30 hover:border-primary/20 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest italic">{status}</span>
                {status === 'processing' && <Activity size={12} className="text-primary animate-pulse" />}
              </div>
              <p className={`text-2xl font-black italic tracking-tighter ${color}`}>
                {count}
              </p>
              <div className="h-1 bg-surface-hover/50 rounded-full mt-2 overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-1000 ${status === 'done' ? 'bg-success' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, (count / Math.max(1, health?.ingestionStats?.pending || 0)) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-3 gap-6">
        {/* Timeline Chart */}
        <div className="col-span-2 glass-panel p-8 rounded-3xl border border-border/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Activity size={120} />
          </div>
          <h3 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground mb-12 flex items-center gap-2">
            <TrendingUp size={14} /> Execution Timeline (Last 24 Pulses)
          </h3>
          
          <div className="h-[300px] flex items-end gap-3 px-4">
            {aggregatedByTime.slice().reverse().map((d) => (
              <div key={d.time} className="flex-1 flex flex-col items-center gap-4 group">
                <div className="relative w-full flex flex-col justify-end gap-1 h-[240px]">
                   {/* Tooltip */}
                   <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-surface border border-border/50 px-2 py-1 rounded text-[9px] font-black uppercase whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all z-20 shadow-xl pointer-events-none">
                     {d.completed} OK / {d.failed} FAIL
                   </div>
                   
                   <div 
                     className="w-full bg-primary/20 rounded-t-lg transition-all duration-700 hover:bg-primary/40 relative overflow-hidden" 
                     style={{ height: `${(d.total / maxCount) * 100}%` }}
                   >
                     <div 
                       className="absolute bottom-0 left-0 w-full bg-primary transition-all duration-1000 delay-300"
                       style={{ height: `${(d.completed / d.total) * 100}%` }}
                     />
                   </div>
                </div>
                <span className="text-[8px] font-black text-muted-foreground uppercase rotate-45 origin-left whitespace-nowrap opacity-40 group-hover:opacity-100 transition-all">
                  {d.time.split(' ').pop()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Provider Distribution Pie/Bar */}
        <div className="glass-panel p-8 rounded-3xl border border-border/50">
          <h3 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground mb-8 flex items-center gap-2">
            <Server size={14} /> Provider Split
          </h3>
          <div className="space-y-6">
            {providerDistribution.map((p, i) => {
              const total = providerDistribution.reduce((acc, curr) => acc + curr.count, 0);
              const percent = (p.count / total) * 100;
              const isCloud = p.provider?.includes('API');
              
              return (
                <div key={p.provider} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isCloud ? <Cloud size={12} className="text-cyan-400" /> : <Server size={12} className="text-primary" />}
                      <span className="text-[10px] font-black uppercase tracking-widest">{p.provider || 'UNKNOWN'}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold opacity-50">{Math.round(percent)}%</span>
                  </div>
                  <div className="h-2 bg-surface-hover/50 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className={`h-full rounded-full transition-all duration-1000 delay-${i * 100} ${isCloud ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'bg-primary shadow-[0_0_10px_rgba(var(--color-primary-rgb),0.3)]'}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="text-[9px] font-bold text-muted-foreground opacity-40 text-right">{p.count} successful tasks</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="glass-panel p-8 rounded-3xl border border-border/50">
        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground mb-8 flex items-center gap-2">
          <Database size={14} /> Raw Execution Ledger
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/30">
                <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Time Window</th>
                <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Task Type</th>
                <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Provider</th>
                <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">Status</th>
                <th className="pb-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground text-right">Volume</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {stats.slice(0, 50).map((s) => (
                <tr key={`${s.time}-${s.type}-${s.provider}-${s.status}`} className="group hover:bg-white/[0.02] transition-colors">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <Calendar size={12} className="text-muted-foreground opacity-30" />
                      <span className="text-[11px] font-mono font-bold opacity-60 group-hover:opacity-100 transition-all">{s.time}</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className="text-[10px] font-black uppercase tracking-tighter bg-surface px-2 py-0.5 rounded-md border border-border/30 group-hover:border-primary/30 transition-all">{s.type}</span>
                  </td>
                  <td className="py-3">
                    <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">{s.provider || 'AUTO'}</span>
                  </td>
                  <td className="py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-tighter ${
                      s.status === 'COMPLETED' ? 'bg-success/10 text-success border border-success/20' : 
                      s.status === 'FAILED' ? 'bg-error/10 text-error border border-error/20' : 
                      'bg-muted/10 text-muted-foreground border border-border/20'
                    }`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <span className="text-sm font-black italic tracking-tighter text-primary">{s.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
