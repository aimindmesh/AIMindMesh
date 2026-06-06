import { useEffect, useState } from 'react';
import { ShieldAlert, Trash2, RefreshCw, Clock, Info } from 'lucide-react';
import { useAdminStore } from '../store/adminStore';
import { adminApi } from '../services/api';

export default function QuarantineView() {
  const { status, fetchFailedHistory, clearFailedHistory } = useAdminStore();

  useEffect(() => {
    fetchFailedHistory();
    const interval = setInterval(fetchFailedHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchFailedHistory]);

  const [isRestoring, setIsRestoring] = useState(false);

  const handleClear = async () => {
    if (window.confirm("Are you sure you want to purge all failed tasks?")) {
      await clearFailedHistory();
    }
  };

  const handleRestoreAll = async () => {
    if (window.confirm("Are you sure you want to restore all quarantined tasks back to the active queue?")) {
      setIsRestoring(true);
      try {
        await adminApi.restoreAllFailedTasks();
        fetchFailedHistory();
      } catch (e) {
        alert("Failed to restore tasks");
      } finally {
        setIsRestoring(false);
      }
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await adminApi.retryInference(id);
      fetchFailedHistory();
    } catch (e) {
      alert("Retry failed");
    }
  };

  const failedTasks = (status?.failedHistory || []).filter((item: any) => 
    item.status === 'FAILED' || item.status === 'STALLED' || item.error_msg
  );

  return (
    <div className="view-content p-4 pb-6 custom-scrollbar animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-2xl font-black tracking-tighter italic">QUARANTINE</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Failed Task Repository</p>
        </div>
        <div className="flex gap-2">
          <button 
            disabled={isRestoring}
            onClick={fetchFailedHistory} 
            className="p-3 rounded-2xl bg-surface border border-border active:scale-90 transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={18} className="text-primary" />
          </button>
          {failedTasks.length > 0 && (
            <button 
              disabled={isRestoring}
              onClick={handleRestoreAll} 
              className="p-3 rounded-2xl bg-primary/10 border border-primary/20 text-primary active:scale-90 transition-all disabled:opacity-50"
              title="Restore All"
            >
              <RefreshCw size={18} className={isRestoring ? "animate-spin" : ""} />
            </button>
          )}
          <button 
            onClick={handleClear}
            disabled={failedTasks.length === 0 || isRestoring}
            className="p-3 rounded-2xl bg-error/10 border border-error/20 text-error active:scale-90 transition-all disabled:opacity-30"
            title="Purge All"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {failedTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 opacity-40">
          <div className="p-6 rounded-full bg-success/10 mb-4">
            <ShieldAlert size={48} className="text-success" />
          </div>
          <p className="text-xs font-black uppercase tracking-widest">System Healthy</p>
          <p className="text-[10px] font-bold uppercase mt-1">No failed tasks found</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 rounded-3xl bg-warning/5 border border-warning/10 flex items-start gap-3">
             <Info size={16} className="text-warning shrink-0 mt-0.5" />
             <p className="text-[10px] text-warning/70 leading-relaxed font-bold uppercase">
               Tasks in this repository failed due to rate limits, network errors, or model hallucinations. 
               You can retry them using the original parameters.
             </p>
          </div>

          <div className="space-y-3">
            {failedTasks.map((item: any) => (
              <div key={item.id} className="p-4 bg-surface/40 border border-border/30 rounded-3xl flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-black tracking-tight truncate uppercase italic text-foreground/90">
                      {item.task_name || 'Unnamed Task'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-muted-foreground font-mono font-bold uppercase tracking-tighter opacity-50">{item.id.slice(0,8)}</span>
                      <span className="text-[8px] font-bold text-muted-foreground/30 uppercase">|</span>
                      <span className="text-[9px] text-primary/70 font-bold uppercase tracking-tighter">{item.type}</span>
                    </div>
                  </div>
                  <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${
                    item.status === 'STALLED' ? 'bg-warning/10 text-warning border-warning/20' : 
                    item.status === 'COMPLETED' ? 'bg-success/10 text-success border-success/20' :
                    'bg-error/10 text-error border-error/20'
                  }`}>
                    {item.status}
                  </div>
                </div>

                <div className="bg-background/40 rounded-2xl p-3 border border-border/20">
                  <div className="flex items-center gap-2 mb-2 opacity-60">
                    <Clock size={10} className="text-muted-foreground" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Failure Data</span>
                  </div>
                  <p className="text-[10px] text-error/90 font-bold leading-tight line-clamp-3 italic">
                    "{item.error_msg || 'Unknown execution error'}"
                  </p>
                  <div className="mt-2 pt-2 border-t border-border/20 flex justify-between items-center">
                    <span className="text-[8px] font-mono font-bold text-muted-foreground/40 uppercase">
                      {formatDateTime(item.created_at)}
                    </span>
                    <span className="text-[8px] font-bold text-muted-foreground/60 uppercase">
                      Model: {item.model || 'AUTO'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => handleRetry(item.id)}
                    className="flex-1 py-3 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-primary/10"
                  >
                    <RefreshCw size={14} /> Retry Task
                  </button>
                  <button 
                    onClick={async () => {
                        await adminApi.deleteTask(item.id);
                        fetchFailedHistory();
                    }}
                    className="p-3 bg-white/5 border border-white/10 text-muted-foreground rounded-2xl active:scale-95 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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
  return date.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
