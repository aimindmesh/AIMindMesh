import { useState, useEffect } from 'react';
import { BarChart3, Clock, Calendar, RefreshCw, Layers } from 'lucide-react';
import { serverApi } from '../../services/serverApi';

interface StatItem {
  time: string;
  type: string;
  provider: string;
  count: number;
}

export function TaskStatsDashboard() {
  const [unit, setUnit] = useState<'hour' | 'day' | 'total'>('hour');
  const [stats, setStats] = useState<StatItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const res = await serverApi.get(`/api/admin/stats/tasks?unit=${unit}`);
      setStats(res.data.stats || []);
    } catch (e) {
      console.error('Failed to fetch stats', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [unit]);

  // Aggregate stats for the chart
  const groupedStats = stats.reduce((acc, curr) => {
    if (!acc[curr.time]) acc[curr.time] = {};
    const key = curr.provider || 'UNKNOWN';
    acc[curr.time][key] = (acc[curr.time][key] || 0) + curr.count;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  const times = Object.keys(groupedStats).sort().slice(-14);
  const providers = Array.from(new Set(stats.map(s => s.provider || 'UNKNOWN')));
  
  const maxCount = Math.max(...times.map(t => Object.values(groupedStats[t]).reduce((a, b) => a + b, 0)), 1);

  const providerColors: Record<string, string> = {
    'GEMINI': 'bg-primary',
    'OPENROUTER': 'bg-purple-500',
    'SERVER_LOCAL': 'bg-success',
    'UNKNOWN': 'bg-muted'
  };

  return (
    <div className="bg-surface border border-border rounded-3xl p-6 mb-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-2xl text-primary">
            <BarChart3 size={20} />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">Compute Distribution</h2>
            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5 italic">Task execution metrics</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-xl">
          <button 
            onClick={() => setUnit('hour')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${unit === 'hour' ? 'bg-surface shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Clock size={12} /> Hourly
          </button>
          <button 
            onClick={() => setUnit('day')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${unit === 'day' ? 'bg-surface shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Calendar size={12} /> Daily
          </button>
          <button 
            onClick={() => setUnit('total')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${unit === 'total' ? 'bg-surface shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Layers size={12} /> Total
          </button>
          <button 
            onClick={fetchStats}
            className="p-1.5 hover:bg-surface rounded-lg transition-all ml-1"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48 flex items-end gap-3 mb-8 px-2">
        {times.length === 0 ? (
          <div className="flex-1 h-full flex items-center justify-center border border-dashed border-border rounded-2xl opacity-40">
             <p className="text-[10px] font-black uppercase tracking-widest">No data collected yet</p>
          </div>
        ) : times.map(time => {
          const vals = groupedStats[time];
          const total = Object.values(vals).reduce((a, b) => a + b, 0);
          
          return (
            <div key={time} className="flex-1 group relative flex flex-col items-center gap-2 h-full">
              <div className="flex-1 w-full flex flex-col justify-end gap-0.5">
                {Object.entries(vals).map(([provider, count]) => (
                  <div 
                    key={provider}
                    style={{ height: `${(count / maxCount) * 100}%` }}
                    className={`w-full rounded-sm opacity-80 group-hover:opacity-100 transition-all ${providerColors[provider] || 'bg-muted'}`}
                  />
                ))}
              </div>
              <span className="text-[8px] font-bold text-muted-foreground/50 rotate-45 origin-left whitespace-nowrap mt-3">
                {unit === 'hour' ? time.split(' ')[1] : time.split('-').slice(1).join('/')}
              </span>
              
              {/* Tooltip */}
              <div className="absolute bottom-full mb-3 hidden group-hover:flex flex-col bg-popover border border-border p-3 rounded-2xl shadow-2xl z-20 min-w-[140px] pointer-events-none">
                <p className="text-[9px] font-black uppercase mb-2 border-b border-border/50 pb-2">{time}</p>
                {Object.entries(vals).map(([p, c]) => (
                  <div key={p} className="flex justify-between items-center gap-6 py-1">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${providerColors[p] || 'bg-muted'}`} />
                      <span className="text-[8px] font-bold text-muted-foreground uppercase">{p === 'SERVER_LOCAL' ? 'NEURAL' : p}</span>
                    </div>
                    <span className="text-[10px] font-black font-mono">{c}</span>
                  </div>
                ))}
                <div className="mt-2 pt-2 border-t border-border/50 flex justify-between items-center">
                  <span className="text-[8px] font-black uppercase">Aggregate</span>
                  <span className="text-[10px] font-black text-primary font-mono">{total}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend & Summary */}
      <div className="grid grid-cols-4 gap-6 mt-16 border-t border-border/30 pt-8">
        {providers.sort().map(p => {
            const totalForP = stats.filter(s => (s.provider || 'UNKNOWN') === p).reduce((a, b) => a + b.count, 0);
            return (
                <div key={p} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${providerColors[p] || 'bg-muted'}`} />
                        <span className="text-[9px] font-black uppercase tracking-tight text-muted-foreground">{p === 'SERVER_LOCAL' ? 'Neural Core' : p}</span>
                    </div>
                    <p className="text-2xl font-black font-mono leading-none tracking-tighter">{totalForP.toLocaleString()}</p>
                </div>
            );
        })}
      </div>
    </div>
  );
}
