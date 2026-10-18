import { Activity, Clock, Pause, Play, RefreshCw, XCircle, Zap } from 'lucide-react';
import { adminApi } from '../../services/api';
import { formatDateTime, formatElapsed } from './queueFormat';

interface ActivityQueuePanelProps {
  /** Server status of the admin store (its inferenceQueue and nodes) */
  status: any;
  fetchStatus: () => void;
}

/** Live inference queue: state of each task, re-route, pause, resume, retry or cancel it. */
export function ActivityQueuePanel({ status, fetchStatus }: ActivityQueuePanelProps) {
  return (
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
                  <option value="CLAUDE">CLAUDE</option>
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
  );
}
