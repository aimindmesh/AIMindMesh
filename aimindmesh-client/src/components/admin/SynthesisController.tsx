import { Play, BrainCircuit, RefreshCw, Activity, Terminal, Zap, Plus, Trash2, Settings2, Users, Layers, Download, ChevronDown, ChevronUp, Pause, XCircle, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { adminApi } from '../../services/serverApi';

interface SynthesisControllerProps {
  config: any;
  onUpdateConfig: (partial: any) => void;
  onTriggerProactive: () => void;
  onTriggerReprocess: () => void;
  onTriggerMerge: () => void;
  onRefreshTabData?: () => void;
  logs: any[];
  activity: any[];
  history: any[];
  isTriggering: boolean;
  availableModels: string[];
  nodes: any[];
}

export function SynthesisController({ config, onUpdateConfig, onTriggerProactive, onTriggerReprocess, onTriggerMerge, onRefreshTabData, logs, activity, history, isTriggering, availableModels, nodes }: SynthesisControllerProps) {
  const [showAllLogs, setShowAllLogs] = useState(false);
  const { performanceMode } = useUIStore();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const hasActive = activity.some(a => a.status === 'PROCESSING');
    if (!hasActive) return;

    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activity]);

  const formatElapsed = (start: number, end?: number) => {
    const finish = end || now;
    const seconds = Math.floor((finish - start) / 1000);
    if (seconds < 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : (m > 0 ? `${m}m ${s}s` : `${s}s`);
  };

  const formatDateTime = (ts: number) => new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  
  const addParticipant = () => {
    const current = config?.debate?.participants || [];
    onUpdateConfig({
      debate: {
        ...config?.debate,
        participants: [...current, { name: 'NEW_AGENT', persona: 'You are an analytical agent.' }]
      }
    });
  };

  const removeParticipant = (index: number) => {
    const current = [...(config?.debate?.participants || [])];
    current.splice(index, 1);
    onUpdateConfig({ debate: { ...config?.debate, participants: current } });
  };

  const updateParticipant = (index: number, field: 'name' | 'persona', value: string) => {
    const current = [...(config?.debate?.participants || [])];
    current[index] = { ...current[index], [field]: value };
    onUpdateConfig({ debate: { ...config?.debate, participants: current } });
  };

  const exportLogs = () => {
    const text = logs.map(log => `[${new Date(log.timestamp).toISOString()}] [${log.module || 'ENGINE'}] ${log.message}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs exported to clipboard.');
  };

  const visibleLogs = showAllLogs ? logs : logs.slice(0, 10);

  return (
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-6 duration-500">
      
      {/* Parameters & Debate Configuration Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Proactive Engine Params */}
        <div className="flex flex-col gap-6">
          <h2 className="text-xl font-black italic flex items-center gap-2 tracking-tighter uppercase">
            <Settings2 className="w-5 h-5 text-primary" /> Engine Parameters
          </h2>
          <div className="glass-panel p-8 rounded-[40px] flex flex-col gap-8 border-primary/10">
            {config?.proactive && (
              <>
                <label className="flex items-center justify-between cursor-pointer p-5 rounded-[28px] border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all group">
                  <div className="flex items-center gap-4">
                     <div className="p-3 bg-primary/10 rounded-2xl text-primary group-hover:scale-110 transition-transform">
                        <BrainCircuit size={20} />
                     </div>
                     <div>
                        <span className="font-black text-lg tracking-tight uppercase italic">Autonomous Synthesis</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-bold uppercase tracking-widest opacity-60">Generate insights without user prompts</p>
                     </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.proactive.enabled}
                    onChange={(e) => onUpdateConfig({ proactive: { ...config.proactive, enabled: e.target.checked } })}
                    className="w-7 h-7 rounded-xl accent-primary bg-background border-border shadow-lg cursor-pointer"
                  />
                </label>

                <div className="grid grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 italic">Interval (Hours)</label>
                    <input
                      type="number" min={1} max={24}
                      value={config.proactive.intervalHours}
                      onChange={(e) => onUpdateConfig({ proactive: { ...config.proactive, intervalHours: parseInt(e.target.value) } })}
                      className="bg-surface border border-border rounded-2xl p-4 outline-none focus:border-primary font-mono font-black text-sm shadow-inner"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 italic">Relevance Threshold</label>
                    <input
                      type="number" step={0.1} min={0} max={1}
                      value={config.proactive.relevanceThreshold}
                      onChange={(e) => onUpdateConfig({ proactive: { ...config.proactive, relevanceThreshold: parseFloat(e.target.value) } })}
                      className="bg-surface border border-border rounded-2xl p-4 outline-none focus:border-primary font-mono font-black text-sm shadow-inner"
                    />
                  </div>
                </div>


                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 italic">Available Server Models</label>
                  <div className="flex flex-wrap gap-2">
                    {availableModels.length > 0 ? availableModels.map(m => (
                      <span key={m} className="px-3 py-1 bg-surface border border-border rounded-lg text-[9px] font-mono font-black text-primary uppercase tracking-tighter">
                        {m}
                      </span>
                    )) : (
                      <span className="text-[9px] text-muted-foreground italic font-bold">No models discovered</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={onTriggerProactive}
                    disabled={isTriggering}
                    className="bg-secondary/20 hover:bg-secondary text-primary font-black py-5 rounded-3xl border border-primary/20 transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:opacity-50 text-xs uppercase tracking-widest italic"
                  >
                    <Play size={18} fill="currentColor" /> Force Synthesis
                  </button>
                  <button
                    onClick={onTriggerReprocess}
                    disabled={isTriggering}
                    className="bg-warning/10 hover:bg-warning/20 text-warning font-black py-5 rounded-3xl border border-warning/20 transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:opacity-50 text-xs uppercase tracking-widest italic"
                  >
                    <RefreshCw size={18} className={isTriggering ? 'animate-spin' : ''} /> Reprocess Recent
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Debate Console (RESTORED PARTICIPANTS) */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black italic flex items-center gap-2 tracking-tighter uppercase">
              <Users className="w-5 h-5 text-warning" /> Participant Manager
            </h2>
            <button 
              onClick={addParticipant}
              className="p-2.5 bg-warning/10 text-warning border border-warning/20 rounded-xl hover:bg-warning/20 transition-all active:scale-90"
            >
              <Plus size={18} />
            </button>
          </div>
          
          <div className="glass-panel p-6 rounded-[40px] flex flex-col gap-6 bg-warning/5 border-warning/10 max-h-[600px] overflow-y-auto custom-scrollbar">
            <label className="flex items-center justify-between cursor-pointer p-4 rounded-3xl border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-all group mb-2">
              <div className="flex items-center gap-3">
                 <RefreshCw size={16} className="text-warning" />
                 <div>
                    <span className="font-black text-base tracking-tight uppercase italic">Thread Merging</span>
                    <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">Consolidate duplicate discussions</p>
                 </div>
              </div>
              <input
                type="checkbox"
                checked={config?.debate?.threadMerging ?? true}
                onChange={(e) => onUpdateConfig({ debate: { ...config?.debate, threadMerging: e.target.checked } })}
                className="w-6 h-6 rounded-xl accent-warning bg-background border-border cursor-pointer"
              />
            </label>

            <div className="flex flex-col gap-2 mb-4 px-4">
               <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest italic">Merge Interval (Hours)</label>
               <input
                 type="number" min={1} max={72}
                 value={config?.debate?.mergeIntervalHours || 12}
                 onChange={(e) => onUpdateConfig({ debate: { ...config?.debate, mergeIntervalHours: parseInt(e.target.value) } })}
                 className="bg-surface border border-border rounded-xl p-3 outline-none focus:border-warning font-mono font-black text-sm"
               />
            </div>

            <div className="space-y-4">
              {config?.debate?.participants?.map((agent: any, i: number) => (
                <div key={i} className="p-6 bg-surface border border-border rounded-3xl flex flex-col gap-4 relative group/agent hover:border-warning/30 transition-all">
                  <div className="flex justify-between items-center">
                    <input 
                      type="text" 
                      value={agent.name}
                      onChange={(e) => updateParticipant(i, 'name', e.target.value)}
                      className="bg-transparent font-black text-sm italic border-none outline-none text-warning uppercase tracking-widest focus:ring-0 w-1/2"
                      placeholder="AGENT_NAME"
                    />
                    <button 
                      onClick={() => removeParticipant(i)}
                      className="p-2 text-muted-foreground hover:text-error opacity-0 group-hover/agent:opacity-100 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <textarea 
                    value={agent.persona}
                    onChange={(e) => updateParticipant(i, 'persona', e.target.value)}
                    rows={3}
                    className="bg-background/50 border border-border p-3 rounded-xl text-xs font-medium leading-relaxed outline-none focus:border-warning/40 transition-all custom-scrollbar"
                    placeholder="System prompt instructions..."
                  />
                </div>
              ))}
              {(!config?.debate?.participants || config.debate.participants.length === 0) && (
                <div className="p-12 text-center text-muted-foreground opacity-30 italic font-medium">No custom agents configured.</div>
              )}
            </div>
            
            <button
               onClick={onTriggerMerge}
               className="mt-2 w-full bg-surface border border-border hover:bg-surface-hover p-4 rounded-3xl text-[10px] font-black uppercase tracking-[0.2em] italic flex items-center justify-center gap-2 transition-all"
            >
               <Layers size={14} className="text-muted-foreground" /> Trigger Manual Merge Cycle
            </button>
          </div>
        </div>
      </div>

      {/* Activity & Logs Row (UNIFORM WIDTH) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 min-h-0">
        
        {/* Activity Queue */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black italic flex items-center gap-2 tracking-widest uppercase opacity-80">
              <Zap className="w-5 h-5 text-warning" /> Activity Queue
            </h3>
            {onRefreshTabData && (
              <button 
                onClick={onRefreshTabData}
                className="p-2 text-muted-foreground hover:text-warning transition-all rounded-lg hover:bg-warning/10 border border-white/5 active:scale-90"
                title="Refresh Activity"
              >
                <RefreshCw size={14} className={isTriggering ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
          <div className="glass-panel p-2 rounded-[40px] flex-1 flex flex-col min-h-[400px] overflow-y-auto bg-surface/20 border-border/50">
            {activity.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 opacity-30 italic text-xs font-bold uppercase tracking-widest">
                Stack Empty
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {activity.map((item, i) => (
                  <div key={i} className="p-4 bg-surface/40 hover:bg-surface border border-transparent hover:border-border rounded-3xl transition-all flex flex-col gap-3 group">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 bg-background rounded-2xl border border-border shadow-sm group-hover:scale-110 transition-transform">
                        <Terminal size={14} className={item.status === 'QUEUED' ? 'text-warning' : item.status === 'PAUSED' ? 'text-muted-foreground' : item.status === 'STALLED' ? 'text-error animate-pulse' : 'text-primary'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-[11px] font-black tracking-tight truncate uppercase italic ${item.status === 'PAUSED' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            {item.taskName || 'Unnamed Inference'}
                          </p>
                        </div>
                        <p className="text-[9px] text-muted-foreground font-mono font-bold opacity-40 uppercase tracking-tighter">{item.type} PHASE</p>
                      </div>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         {item.status === 'PAUSED' ? (
                            <button onClick={() => adminApi.resumeInference(item.id)} className="p-1.5 text-success hover:bg-success/10 rounded-lg transition-colors" title="Resume">
                               <Play size={14} />
                            </button>
                         ) : (item.status === 'QUEUED' || item.status === 'STALLED' || item.status === 'WAITING') ? (
                            <>
                              {item.status === 'STALLED' && (
                                <button onClick={() => adminApi.retryInference(item.id)} className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors" title="Retry">
                                  <RefreshCw size={14} />
                                </button>
                              )}
                              <button onClick={() => adminApi.pauseInference(item.id)} className="p-1.5 text-warning hover:bg-warning/10 rounded-lg transition-colors" title="Pause">
                                 <Pause size={14} />
                              </button>
                            </>
                         ) : null}
                         <button onClick={() => adminApi.cancelInference(item.id)} className="p-1.5 text-error hover:bg-error/10 rounded-lg transition-colors" title="Cancel">
                            <XCircle size={14} />
                         </button>
                      </div>
                    </div>
 
                    <div className="flex items-center justify-between pl-12">
                       <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black text-muted-foreground/60 uppercase tracking-widest italic">Target:</span>
                          {(item.status === 'QUEUED' || item.status === 'STALLED' || item.status === 'WAITING') ? (
                            <select 
                              value={item.model || 'auto'}
                              onChange={(e) => adminApi.updateInferenceRouting(item.id, e.target.value)}
                              className="bg-background border border-border rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest outline-none hover:border-primary/40 transition-colors"
                            >
                              <option value="auto">AUTOMATIC (BALANCED)</option>
                              <option value="laptop">LOCAL COMPUTE (PC)</option>
                              <option value="server">NEURAL CORE (SERVER)</option>
                              {availableModels.map(m => (
                                <option key={m} value={`model:${m}`}>{m.toUpperCase()}</option>
                              ))}
                              {nodes.filter(n => n.id !== 'SERVER_LOCAL' && n.type !== 'pc_client' && n.id !== 'LAPTOP').map(n => (
                                <option key={n.id} value={n.id}>{n.id.toUpperCase()} (MESH)</option>
                              ))}
                              <option value="gemini">GEMINI</option>
                              <option value="openrouter">OPENROUTER</option>
                              <option value="freellmapi">FREELLMAPI</option>
                            </select>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 bg-background border border-border rounded text-primary uppercase font-mono tracking-widest font-black">
                              {item.model || 'AUTO'}
                            </span>
                          )}
                       </div>
 
                       <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-[9px] font-black uppercase italic ${item.status === 'QUEUED' ? 'text-warning animate-pulse' : item.status === 'WAITING' ? 'text-orange-400 animate-pulse' : item.status === 'PAUSED' ? 'text-muted-foreground' : item.status === 'STALLED' ? 'text-error font-black' : 'text-success'}`}>
                          {item.status === 'PROCESSING' ? (
                             <span className="flex items-center gap-1.5">
                                <Zap size={10} className="animate-pulse" />
                                EXECUTION ACTIVE: {item.processingStartedAt ? formatElapsed(item.processingStartedAt) : 'INITIALIZING'}
                             </span>
                          ) : item.status === 'STALLED' ? (
                            <span className="flex items-center gap-1.5">
                               <XCircle size={10} />
                               STALLED: RETRIES EXHAUSTED
                            </span>
                          ) : item.status === 'WAITING' ? (
                            <span className="flex items-center gap-1.5">
                               <Clock size={10} className="animate-spin" />
                               COOLDOWN: GEMINI QUOTA EXCEEDED
                            </span>
                          ) : item.status}
                        </span>
                        <div className="flex flex-col items-end opacity-40">
                          <span className="text-[8px] font-mono font-bold">
                             {item.status === 'PROCESSING' && item.processingStartedAt ? `STARTED: ${formatDateTime(item.processingStartedAt)}` : `QUEUED: ${formatDateTime(item.startedAt)}`}
                          </span>
                          {item.status === 'QUEUED' && typeof item.queuePosition === 'number' && (
                            <span className="text-[8px] font-mono font-bold">POS: {item.queuePosition + 1}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inference History */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black italic flex items-center gap-2 tracking-widest uppercase opacity-80">
              <Activity className="w-5 h-5 text-success" /> Inference History
            </h3>
            {onRefreshTabData && (
              <button 
                onClick={onRefreshTabData}
                className="p-2 text-muted-foreground hover:text-success transition-all rounded-lg hover:bg-success/10 border border-white/5 active:scale-90"
                title="Refresh History"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
          <div className="glass-panel p-2 rounded-[40px] flex-1 flex flex-col min-h-[400px] max-h-[600px] overflow-y-auto bg-surface/10 border-border/50 custom-scrollbar">
            {history.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 opacity-30 italic text-xs font-bold uppercase tracking-widest">
                No Record Found
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {history.filter(item => item.status === 'COMPLETED').map((item, i) => (
                  <div key={i} className="p-4 bg-background/40 hover:bg-background/80 border border-white/5 rounded-3xl transition-all flex flex-col gap-2 group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full ${item.status === 'COMPLETED' ? 'bg-success' : 'bg-error'}`} />
                        <p className="text-[10px] font-black tracking-tight truncate uppercase italic text-foreground/90">
                          {item.task_name || 'Inference'}
                        </p>
                      </div>
                      <button 
                        onClick={() => adminApi.retryInference(item.id)}
                        className="p-2 bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-all active:scale-90 opacity-0 group-hover:opacity-100"
                        title="Retry Task"
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono font-bold text-muted-foreground uppercase">{item.model || 'AUTO'}</span>
                          <span className="text-[8px] font-mono font-bold opacity-30">|</span>
                          <span className="text-[8px] font-mono font-bold opacity-40">IN: {formatDateTime(item.created_at)}</span>
                          {item.completed_at && (
                            <>
                              <span className="text-[8px] font-mono font-bold opacity-30">|</span>
                              <span className="text-[8px] font-mono font-bold opacity-40">OUT: {formatDateTime(item.completed_at)}</span>
                            </>
                          )}
                        </div>
                        {item.completed_at && (
                          <span className="text-[7px] font-black uppercase tracking-widest text-primary/40 italic">
                            DURATION: {formatElapsed(item.created_at, item.completed_at)}
                          </span>
                        )}
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-widest ${item.status === 'COMPLETED' ? 'text-success/60' : 'text-error'}`}>
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
            )}
          </div>
        </div>

        {/* Synthesis Logs */}
        <div className="md:col-span-1 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black italic flex items-center gap-2 tracking-widest uppercase opacity-80">
              <Activity className="w-5 h-5 text-primary" /> Synthesis Logs
            </h3>
            <div className="flex items-center gap-3">
              <button 
                onClick={exportLogs}
                className="p-2 text-muted-foreground hover:text-primary transition-all rounded-lg hover:bg-primary/10 border border-white/5 active:scale-90"
                title="Export all logs to clipboard"
              >
                <Download size={16} />
              </button>
              <span className="text-[10px] font-black px-3 py-1 bg-primary/10 text-primary border border-primary/20 rounded-xl uppercase tracking-widest italic">Brainstream Sync</span>
            </div>
          </div>
          
          <div className={`glass-panel p-4 rounded-[40px] flex-1 flex flex-col ${performanceMode ? 'max-h-[300px]' : 'max-h-[500px]'} overflow-y-auto bg-[#070a14]/[0.6] border-border/50 custom-scrollbar`}>
            {logs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-16 gap-3 opacity-30 italic text-xs font-bold uppercase tracking-widest">
                 Awaiting synaptic events...
              </div>
            ) : (
              <div className="space-y-3">
                {visibleLogs.map((log, i) => (
                  <div key={i} className="p-5 bg-background/50 hover:bg-background/90 rounded-[28px] border border-white/5 hover:border-border transition-all flex items-start gap-5 group">
                    <div className={`mt-2.5 w-2.5 h-2.5 rounded-full shrink-0 ${log.level === 'ERROR' ? 'bg-error shadow-[0_0_12px_rgba(239,68,68,0.8)]' : log.level === 'WARN' ? 'bg-warning' : 'bg-success shadow-[0_0_12px_rgba(34,197,94,0.8)]'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-black text-[10px] uppercase tracking-[0.2em] text-primary group-hover:text-primary-hover transition-colors italic">{log.module || 'ENGINE'}</span>
                        <span className="text-[10px] text-muted-foreground font-mono font-bold opacity-30 group-hover:opacity-60 transition-opacity">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-[13px] text-foreground/90 leading-relaxed font-bold tracking-tight selection:bg-primary/20">{log.message}</p>
                    </div>
                  </div>
                ))}
                
                {logs.length > 10 && (
                  <button 
                    onClick={() => setShowAllLogs(!showAllLogs)}
                    className="w-full p-4 mt-2 border border-dashed border-primary/20 hover:border-primary/40 rounded-3xl text-[10px] font-black uppercase tracking-widest text-primary/60 hover:text-primary transition-all flex items-center justify-center gap-2"
                  >
                    {showAllLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAllLogs ? 'Collapse Stream' : `Show ${logs.length - 10} More Signal Pulses`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
