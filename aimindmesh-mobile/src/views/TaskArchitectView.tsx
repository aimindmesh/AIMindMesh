import React, { useState, useEffect, useCallback } from 'react';
import { AIMindMeshServerSettings } from '../types';
import { AiTaskService } from '../services/calendar/AiTaskService';
import { triggerHaptic } from '../services/native';
import ReactMarkdown from 'react-markdown';

interface TaskArchitectViewProps {
  serverSettings: AIMindMeshServerSettings | undefined;
}

const TaskArchitectView: React.FC<TaskArchitectViewProps> = ({ serverSettings }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<{ taskId: string, content: string } | null>(null);

  const loadTasks = useCallback(async () => {
    if (!serverSettings?.enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await AiTaskService.getAllServerTasks();
      setTasks(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [serverSettings]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [loadTasks]);

  const handleRunTask = async (taskId: string) => {
    try {
      triggerHaptic('MEDIUM');
      await AiTaskService.runNow(taskId);
      loadTasks();
    } catch (e: any) {
      alert('Trigger failed: ' + e.message);
    }
  };

  const handleViewArtifact = async (taskId: string) => {
    try {
      setLoading(true);
      const content = await AiTaskService.getArtifact(taskId);
      setSelectedArtifact({ taskId, content });
      triggerHaptic('LIGHT');
    } catch (e: any) {
      alert('Failed to load artifact: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500 text-blue-100 animate-pulse';
      case 'needs_review': return 'bg-amber-500 text-amber-100';
      case 'failed': return 'bg-red-500 text-red-100';
      case 'completed': return 'bg-green-500 text-green-100';
      case 'queued': return 'bg-gray-500 text-gray-100';
      default: return 'bg-zinc-700 text-zinc-300';
    }
  };

  if (selectedArtifact) {
    return (
      <div className="flex flex-col h-full bg-background animate-fade-in z-50 absolute inset-0">
        <header className="px-5 pt-12 pb-3 flex items-center justify-between border-b border-white/10 shrink-0 bg-surface/90 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedArtifact(null)} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
              <span className="text-xl">←</span>
            </button>
            <h1 className="text-lg font-bold truncate pr-4 text-text-primary">
              Output: {selectedArtifact.taskId}
            </h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="prose prose-invert max-w-none prose-sm">
            <ReactMarkdown>{selectedArtifact.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative">
      <header className="px-5 pt-5 pb-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Neural Architect
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">Manage server-side AI agents</p>
        </div>
        <button
          onClick={loadTasks}
          disabled={loading}
          className="p-2 rounded-xl bg-surface/80 border border-white/10"
        >
          <svg className={`w-4 h-4 text-text-secondary ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </header>

      {error && (
        <div className="mx-5 mb-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {tasks.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-60">
            <div className="text-5xl">🏗️</div>
            <h2 className="text-xl font-bold">No tasks found</h2>
            <p className="text-sm">Create tasks in the Agenda or from the PC client.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pt-2">
            {tasks.map(task => (
              <div 
                key={task.id}
                className="group relative rounded-3xl overflow-hidden border border-white/5 bg-surface/40 p-5 transition-all hover:bg-surface/60 active:scale-[0.98]"
              >
                {/* Status Indicator Bar */}
                <div className={`absolute top-0 left-0 w-1.5 h-full ${getStatusColor(task.lastExecution?.status).split(' ')[0]}`} />
                
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-bold text-text-primary text-base leading-tight">{task.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-text-secondary font-mono tracking-tighter opacity-70">{task.id}</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-[10px] text-primary/80 uppercase font-bold tracking-widest">{task.model}</span>
                      </div>
                    </div>
                    {task.lastExecution && (
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${getStatusColor(task.lastExecution.status)}`}>
                        {task.lastExecution.status}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-text-secondary line-clamp-2 italic opacity-80">
                    "{task.promptTemplate}"
                  </p>

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => handleRunTask(task.id)}
                      className="flex-1 bg-white/5 hover:bg-blue-500/20 text-white text-[11px] font-bold py-2.5 rounded-2xl border border-white/5 transition-colors flex items-center justify-center gap-2"
                    >
                      <span className="text-sm">▶</span> RUN
                    </button>
                    {task.lastExecution?.artifactPath && (
                      <button
                        onClick={() => handleViewArtifact(task.id)}
                        className="flex-1 bg-white/5 hover:bg-indigo-500/20 text-white text-[11px] font-bold py-2.5 rounded-2xl border border-white/5 transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="text-sm">📄</span> OUTPUT
                      </button>
                    )}
                  </div>

                  {task.cronExpression && (
                    <div className="flex items-center gap-1.5 opacity-60 mt-1">
                      <span className="text-xs">🕒</span>
                      <span className="text-[10px] font-medium">{task.cronExpression}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskArchitectView;
