import { Clock, RefreshCw, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/api';
import { formatDateTime, formatElapsed } from './queueFormat';

interface ExecutionHistoryPanelProps {
  /** Server status of the admin store (its queueHistory) */
  status: any;
  fetchStatus: () => void;
  init: () => void;
}

/** Last completed and failed inference tasks, with retry and clear. */
export function ExecutionHistoryPanel({ status, fetchStatus, init }: ExecutionHistoryPanelProps) {
  return (
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
  );
}
