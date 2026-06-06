import { useNodeStore } from '../store/nodeStore';
import { useOpenClawStore } from '../store/openclawStore';
import { useAiTaskStore } from '../store/aiTaskStore';
import { useUIStore } from '../store/uiStore';
import { useEffect } from 'react';

export default function Dashboard() {
  const status = useNodeStore((state) => state.status);
  const ollamaRunning = useNodeStore((state) => state.ollamaRunning);
  const ollamaModel = useNodeStore((state) => state.ollamaModel);
  const ollamaRamUsageMb = useNodeStore((state) => state.ollamaRamUsageMb);
  const { available: clawAvailable, cronJobs, skills } = useOpenClawStore();
  const { tasks, loadTasks } = useAiTaskStore();
  const { setActiveTab } = useUIStore();

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const activeTasksCount = tasks.filter(t => t.status === 'active').length;
  const runningTasksCount = tasks.filter(t => ['running', 'queued'].includes(t.lastExecution?.status ?? '')).length;
  const needsReviewCount = tasks.filter(t => t.lastExecution?.status === 'needs_review').length;

  return (
    <div className="p-6 h-full flex flex-col gap-6 w-full animate-fade-in">
      <h1 className="text-3xl font-bold font-sans tracking-tight">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden">
          <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">Node Status</span>
          <div className="flex items-center gap-3 mt-1">
            <div
              className={`w-4 h-4 rounded-full ${status === 'ONLINE' ? 'bg-success animate-pulse' : 'bg-destructive'}`}
              style={{ boxShadow: status === 'ONLINE' ? '0 0 10px var(--color-success)' : '0 0 10px var(--color-destructive)' }}
            />
            <span className="text-xl font-medium">{status}</span>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden">
          <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">Ollama Inference</span>
          <div className="flex items-center gap-3 mt-1">
            <div
              className={`w-4 h-4 rounded-full ${ollamaRunning ? 'bg-primary animate-pulse' : 'bg-muted'}`}
              style={{ boxShadow: ollamaRunning ? '0 0 10px var(--color-primary)' : 'none' }}
            />
            <span className="text-xl font-medium">{ollamaRunning ? (ollamaModel || 'Idle') : 'Stopped'}</span>
          </div>
          {ollamaRamUsageMb && (
             <span className="absolute bottom-6 right-6 text-xs text-muted-foreground font-mono">{ollamaRamUsageMb} MB</span>
          )}
        </div>

        <div className="glass-panel p-6 rounded-2xl flex flex-col gap-2">
          <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">Server</span>
          <div className="flex items-center gap-3 mt-1">
            <div
              className={`w-4 h-4 rounded-full ${status === 'ONLINE' ? 'bg-success' : 'bg-warning animate-pulse'}`}
              style={{ boxShadow: status === 'ONLINE' ? '0 0 10px var(--color-success)' : '0 0 10px var(--color-warning)' }}
            />
            <span className="text-xl font-medium">{status === 'ONLINE' ? 'Synched' : 'Unreachable'}</span>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden group">
          <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">OpenClaw Agent</span>
          <div className="flex items-center gap-3 mt-1">
            <div
              className={`w-4 h-4 rounded-full ${clawAvailable ? 'bg-success animate-pulse' : 'bg-muted'}`}
              style={{ boxShadow: clawAvailable ? '0 0 10px var(--color-success)' : 'none' }}
            />
            <span className="text-xl font-medium">{clawAvailable ? 'Active' : 'Offline'}</span>
          </div>
          <div className="flex gap-4 mt-2 text-[10px] uppercase font-bold text-muted-foreground/60 tracking-widest">
            <span>{skills.length} Skills</span>
            <span>{cronJobs.filter(j => j.enabled).length} Crons</span>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden group cursor-pointer hover:border-primary/30 transition-all" onClick={() => setActiveTab('tasks')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">AI Task Scheduler</span>
            <span className="text-[10px] font-bold text-primary group-hover:underline">Manage →</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div
              className={`w-4 h-4 rounded-full ${activeTasksCount > 0 ? 'bg-success' : 'bg-muted'}`}
              style={{ boxShadow: activeTasksCount > 0 ? '0 0 10px var(--color-success)' : 'none' }}
            />
            <span className="text-xl font-medium">{activeTasksCount} Active Nodes</span>
          </div>
          <div className="flex gap-4 mt-2 text-[10px] uppercase font-bold tracking-widest">
            <span className={runningTasksCount > 0 ? 'text-primary animate-pulse' : 'text-muted-foreground/60'}>
                {runningTasksCount} Running
            </span>
            <span className={needsReviewCount > 0 ? 'text-warning' : 'text-muted-foreground/60'}>
                {needsReviewCount} Due Review
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
