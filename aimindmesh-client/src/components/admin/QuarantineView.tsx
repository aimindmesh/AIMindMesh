import { ShieldAlert, Trash2, RefreshCw, Clock, Info, Activity } from 'lucide-react';
import { adminApi } from '../../services/serverApi';
import { useState } from 'react';

interface QuarantineViewProps {
  tasks: any[];
  onRefresh: () => void;
}

export function QuarantineView({ tasks, onRefresh }: QuarantineViewProps) {
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  const handleRetry = async (id: string) => {
    setIsProcessing(id);
    try {
      await adminApi.retryInference(id);
      onRefresh();
    } finally {
      setIsProcessing(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this task?')) return;
    setIsProcessing(id);
    try {
      await adminApi.deleteTask(id);
      onRefresh();
    } finally {
      setIsProcessing(null);
    }
  };

  const [isBulkRestoring, setIsBulkRestoring] = useState(false);

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear the entire quarantine?')) return;
    try {
      await adminApi.clearQueueHistory('FAILED');
      onRefresh();
    } catch (e) {}
  };

  const handleRestoreAll = async () => {
    if (!confirm('Are you sure you want to restore all quarantined tasks to the active queue?')) return;
    setIsBulkRestoring(true);
    try {
      await adminApi.restoreAllFailedTasks();
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setIsBulkRestoring(false);
    }
  };

  const formatDateTime = (ts: number) => new Date(ts).toLocaleString('it-IT', { 
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-error/10 rounded-2xl text-error border border-error/20">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black tracking-tight italic uppercase">Task Quarantine</h2>
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest opacity-60">Isolate and recover failed neural operations</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-surface border border-border text-[10px] font-black uppercase tracking-widest hover:bg-surface-hover transition-all active:scale-95"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          {tasks.length > 0 && (
            <>
              <button
                disabled={isBulkRestoring}
                onClick={handleRestoreAll}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all active:scale-95 disabled:opacity-50"
              >
                {isBulkRestoring ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Restore All
              </button>
              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-error/10 text-error border border-error/20 text-[10px] font-black uppercase tracking-widest hover:bg-error/20 transition-all active:scale-95"
              >
                <Trash2 size={14} /> Purge All
              </button>
            </>
          )}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 opacity-40 italic">
          <ShieldAlert size={48} className="mb-4 opacity-20" />
          <p className="text-sm font-black uppercase tracking-[0.3em]">System Clean: No Quarantined Tasks</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tasks.map((item) => (
            <div key={item.id} className="glass-panel p-6 rounded-[32px] border-white/5 hover:border-error/20 transition-all flex flex-col gap-4 group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl border ${item.status === 'STALLED' ? 'bg-warning/10 text-warning border-warning/20' : 'bg-error/10 text-error border-error/20'}`}>
                    <Activity size={18} className={item.status === 'STALLED' ? 'animate-pulse' : ''} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black tracking-tight uppercase italic text-foreground/90 leading-tight">
                      {item.task_name || 'Neural Operation'}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-primary/70 font-bold uppercase tracking-tighter">{item.type}</span>
                      <span className="text-[8px] opacity-20 font-bold">|</span>
                      <span className="text-[9px] text-muted-foreground font-mono font-bold">{item.id.slice(0, 8)}</span>
                    </div>
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

              <div className="bg-background/40 border border-border p-4 rounded-2xl flex flex-col gap-2">
                <div className="flex items-center gap-2 opacity-60">
                   <Info size={12} className="text-primary" />
                   <span className="text-[9px] font-black uppercase tracking-widest italic">Error Signature:</span>
                </div>
                <p className="text-[11px] text-error/90 font-bold leading-tight font-mono break-all">
                  {item.error_msg || 'Unknown execution error: Node timed out or connection lost.'}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 opacity-50">
                  <div className="flex items-center gap-1.5">
                    <Clock size={12} />
                    <span className="text-[10px] font-mono font-black">{formatDateTime(item.created_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    disabled={isProcessing === item.id}
                    onClick={() => handleDelete(item.id)}
                    className="p-2.5 bg-surface border border-border rounded-xl text-muted-foreground hover:text-error hover:bg-error/10 transition-all active:scale-90"
                    title="Delete permanently"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    disabled={isProcessing === item.id}
                    onClick={() => handleRetry(item.id)}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:bg-primary-hover transition-all active:scale-95 shadow-lg shadow-primary/20"
                  >
                    {isProcessing === item.id ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    RETRY OPERATION
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
