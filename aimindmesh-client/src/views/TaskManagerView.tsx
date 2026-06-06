/**
 * TaskManagerView.tsx
 *
 * View principale per la gestione dei task AI sul client PC.
 * Layout a due colonne: lista/kanban a sinistra, pannello dettaglio a destra.
 * Tutti i dati vengono dal server via aiTaskStore.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useAiTaskStore } from '../store/aiTaskStore';
import { ServerAiTask } from '../types/aiTask';
import TaskCard from '../components/tasks/TaskCard';
import TaskDetailPanel from '../components/tasks/TaskDetailPanel';
import TaskFilters, { PcTaskFilters } from '../components/tasks/TaskFilters';

// ── Applica filtri client-side ─────────────────────────────────────────────
function applyFilters(tasks: ServerAiTask[], f: PcTaskFilters): ServerAiTask[] {
  return tasks.filter(t => {
    if (f.status && t.status !== f.status) return false;
    if (f.model  && t.model  !== f.model)  return false;
    if (f.executionStatus && t.lastExecution?.status !== f.executionStatus) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) &&
          !t.promptTemplate.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

const TaskManagerView: React.FC = () => {
  const { tasks, isLoading, error, loadTasks, selectTask, selectedTask } = useAiTaskStore();
  const [filters,      setFilters]      = useState<PcTaskFilters>({});
  const [showNewPanel, setShowNewPanel] = useState(false);

  useEffect(() => {
    loadTasks();
    // Polling smart per aggiornare stati running in background
    const interval = setInterval(loadTasks, 15_000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  const filtered = useMemo(() => applyFilters(tasks, filters), [tasks, filters]);

  // Global Context Stats
  const needsReviewCount = tasks.filter(t =>
    t.lastExecution?.status === 'needs_review'
  ).length;
  const activeCount = tasks.filter(t =>
    t.lastExecution?.status === 'running' || t.lastExecution?.status === 'queued'
  ).length;

  const isPanelOpen = showNewPanel || selectedTask !== null;

  const handleNewTask = () => {
    selectTask(null);
    setShowNewPanel(true);
  };

  const handleClosePanel = () => {
    selectTask(null);
    setShowNewPanel(false);
    loadTasks();
  };

  const handleSelectTask = (task: ServerAiTask) => {
    setShowNewPanel(false);
    selectTask(task);
  };

  return (
    <div className="flex flex-col h-full bg-background animate-fade-in relative">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-surface/30 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <span className="text-primary text-3xl">🤖</span> AI Architect
          </h1>
          <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 px-3 py-1 rounded-full animate-pulse uppercase tracking-widest shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                  ⚡ {activeCount} Neural Threads Running
                </span>
              )}
              {needsReviewCount > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold bg-warning/10 text-warning border border-warning/20 px-3 py-1 rounded-full uppercase tracking-widest">
                  ⚠ {needsReviewCount} Manual Supervisions Pending
                </span>
              )}
          </div>
        </div>
        <button
          onClick={handleNewTask}
          className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-surface text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center gap-2"
        >
          + Deploy New Agent Logic
        </button>
      </div>

      {/* ── Filter Bar ── */}
      <div className="px-8 py-4 border-b border-white/5 bg-surface/10">
        <TaskFilters onChange={setFilters} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Main List Area ── */}
        <div className={`flex flex-col overflow-y-auto custom-scrollbar transition-all duration-500 ${isPanelOpen ? 'flex-[0.6]' : 'flex-1'} bg-background/50`}>

          {error && (
            <div className="mx-8 mt-6 px-6 py-4 bg-error/10 border border-error/30 rounded-2xl text-error font-bold text-xs flex items-center gap-3 animate-shake">
                <span>✕</span> {error}
            </div>
          )}

          {isLoading && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 opacity-50 space-y-4">
                <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <p className="text-xs font-bold uppercase tracking-[0.2em]">Synchronizing Orchestrator...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center p-12 space-y-4">
               <div className="text-6-xl opacity-10">🤖</div>
               <div>
                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        {Object.keys(filters).length > 0 ? 'No entities matched your telemetry' : 'Void Detected'}
                    </p>
                    <p className="text-xs text-muted-foreground opacity-60 mt-2">
                         {Object.keys(filters).length === 0 && 'No AI management tasks have been architected yet.'}
                    </p>
               </div>
               {Object.keys(filters).length === 0 && (
                <button
                    onClick={handleNewTask}
                    className="text-xs font-bold text-primary hover:text-primary-hover transition-colors uppercase tracking-widest mt-4 bg-primary/10 px-6 py-2 rounded-xl border border-primary/20"
                >
                    Initialize First Agent 
                </button>
               )}
            </div>
          ) : (
            <div className="p-8 grid grid-cols-1 2xl:grid-cols-2 gap-6 content-start animate-fade-in-up">
              {filtered.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  selected={selectedTask?.id === task.id}
                  onClick={() => handleSelectTask(task)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Detail Panel (Sidebar) ── */}
        {isPanelOpen && (
          <TaskDetailPanel
            task={showNewPanel ? null : selectedTask}
            onClose={handleClosePanel}
          />
        )}
      </div>
    </div>
  );
};

export default TaskManagerView;
