import React from 'react';
import { Play, Square, Trash2, ListTodo } from 'lucide-react';
import { useAiTaskStore } from '../../store/aiTaskStore';

const EXECUTION_STATUS_CONFIG: Record<string, { label: string, color: string, bg: string }> = {
  success: { label: 'SUCCESS', color: 'text-success', bg: 'bg-success/10' },
  failed: { label: 'FAILED', color: 'text-error', bg: 'bg-error/10' },
  running: { label: 'RUNNING', color: 'text-primary', bg: 'bg-primary/10' },
  needs_review: { label: 'REVIEW', color: 'text-warning', bg: 'bg-warning/10' },
};

export const TaskOrchestrator: React.FC = () => {
  const { tasks, isLoading, runNow, deleteTask, pauseTask, resumeTask } = useAiTaskStore();

  // Removed redundant loadTasks from mount to prevent infinite render loops.
  // The parent AdminPanel already orchestrates task polling centrally.

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

  if (isLoading && tasks.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center py-20 opacity-40">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest">Querying Task Registry...</p>
        </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Layer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Taskset', value: tasks.length, color: 'text-white' },
          { label: 'Active Pipeline', value: tasks.filter(t => t.status === 'active').length, color: 'text-success' },
          { label: 'Suspended Logic', value: tasks.filter(t => t.status === 'paused').length, color: 'text-warning' },
          { label: 'Pending Review', value: tasks.filter(t => t.lastExecution?.status === 'needs_review').length, color: 'text-primary' },
        ].map(item => (
          <div key={item.label} className="glass-panel p-6 rounded-[32px] border-white/5 bg-surface/40 hover:bg-surface/60 transition-colors">
            <p className={`text-3xl font-black italic tracking-tighter ${item.color}`}>{item.value}</p>
            <p className="text-[10px] font-black text-muted-foreground uppercase opacity-60 tracking-[0.2em] mt-2 italic">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Main Orchestration Table */}
      <div className="rounded-[40px] border border-white/10 overflow-hidden bg-[#0a0d17] shadow-2xl">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th className="px-8 py-6 font-black text-muted-foreground uppercase tracking-[0.2em] italic">Functional Entity</th>
              <th className="px-8 py-6 font-black text-muted-foreground uppercase tracking-[0.2em] italic">Engine</th>
              <th className="px-8 py-6 font-black text-muted-foreground uppercase tracking-[0.2em] italic">Cron Schedule</th>
              <th className="px-8 py-6 font-black text-muted-foreground uppercase tracking-[0.2em] italic">Last Pulse</th>
              <th className="px-8 py-6 font-black text-muted-foreground uppercase tracking-[0.2em] italic">Telemetry</th>
              <th className="px-8 py-6 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tasks.map((task) => {
              const exec = task.lastExecution;
              const execCfg = exec ? EXECUTION_STATUS_CONFIG[exec.status] : null;
              return (
                <tr key={task.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-8 py-6">
                      <p className="font-black text-base text-white tracking-tight truncate max-w-[280px] italic">{task.title}</p>
                      <p className="text-[9px] opacity-40 font-mono font-black uppercase tracking-tighter mt-1">ID_{task.id.slice(0,12)}</p>
                  </td>
                  <td className="px-8 py-6">
                      <span className="bg-surface border border-white/10 px-3 py-1.5 rounded-xl text-[10px] uppercase font-black text-primary italic shadow-inner">{task.model}</span>
                  </td>
                  <td className="px-8 py-6 text-muted-foreground font-mono font-bold tracking-tight">
                    {task.cronExpression || 'MANUAL_ONLY'}
                  </td>
                  <td className="px-8 py-6 text-muted-foreground font-black opacity-60 italic">
                    {exec ? formatDate(exec.updatedAt) : 'VOID_SIGNAL'}
                  </td>
                  <td className="px-8 py-6">
                    {execCfg ? (
                      <span className={`text-[10px] font-black px-4 py-1.5 rounded-2xl border-2 uppercase tracking-[0.2em] italic ${execCfg.color} ${execCfg.bg} border-current/20 shadow-lg`}>
                        {execCfg.label}
                      </span>
                    ) : (
                      <div className="flex items-center gap-3">
                         <div className={`w-2.5 h-2.5 rounded-full ${task.status === 'active' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-warning shadow-[0_0_8px_rgba(234,179,8,0.6)]'}`} />
                         <span className={`text-[10px] font-black uppercase tracking-[0.2em] italic ${task.status === 'active' ? 'text-success' : 'text-warning'}`}>
                           {task.status === 'active' ? 'ONLINE' : 'DORMANT'}
                         </span>
                      </div>
                    )}
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                      <button
                        onClick={() => runNow(task.id)}
                        className="p-3 text-muted-foreground hover:text-primary transition-all rounded-2xl hover:bg-white/5 border border-transparent hover:border-primary/20 shadow-xl"
                        title="Force Hot Run"
                      ><Play size={18} fill="currentColor" className="opacity-80"/></button>
                      <button
                        onClick={() => task.status === 'active' ? pauseTask(task.id) : resumeTask(task.id)}
                        className={`p-3 transition-all rounded-2xl hover:bg-white/5 border border-transparent ${task.status === 'active' ? 'text-muted-foreground hover:text-warning hover:border-warning/20' : 'text-muted-foreground hover:text-success hover:border-success/20'} shadow-xl`}
                        title={task.status === 'active' ? 'Suspend Node' : 'Initialize Node'}
                      >{task.status === 'active' ? <Square size={18} fill="currentColor" className="opacity-80"/> : <Play size={18} fill="currentColor" className="opacity-80"/>}</button>
                      <button
                        onClick={() => { if (confirm(`Permanently de-provision task "${task.title}"?`)) deleteTask(task.id); }}
                        className="p-3 text-muted-foreground hover:text-error transition-all rounded-2xl hover:bg-white/5 border border-transparent hover:border-error/20 shadow-xl"
                        title="De-provision"
                      ><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {tasks.length === 0 && !isLoading && (
          <div className="py-24 text-center flex flex-col items-center gap-4 opacity-30">
              <ListTodo size={64} className="mb-2" />
              <p className="text-sm font-black uppercase tracking-[0.4em] italic">Registry Void</p>
              <p className="text-xs font-bold">No functional entities orchestrated on the local cluster.</p>
          </div>
        )}
      </div>
    </div>
  );
};
