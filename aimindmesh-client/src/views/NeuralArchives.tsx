import { useEffect, useState } from 'react';
import { aiTaskService } from '../services/aiTaskService';
import { AiTaskExecution, ServerAiTask } from '../types/aiTask';
import ArtifactViewer from '../components/tasks/ArtifactViewer';
import { Trash2, FileText, Database, Activity } from 'lucide-react';
import { format } from 'date-fns';

export default function NeuralArchives() {
  const [executions, setExecutions] = useState<AiTaskExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksMap, setTasksMap] = useState<Record<string, ServerAiTask>>({});
  const [selectedExec, setSelectedExec] = useState<AiTaskExecution | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const execs = await aiTaskService.listAllExecutions(200);
      const tasks = await aiTaskService.listTasks();
      const map: Record<string, ServerAiTask> = {};
      tasks.forEach(t => map[t.id] = t);
      setExecutions(execs);
      setTasksMap(map);
    } catch (e) {
      console.error("Failed to load archives", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (exec: AiTaskExecution) => {
    setSelectedExec(exec);
    if (exec.artifactPath) {
      setLoadingArtifact(true);
      try {
        const text = await aiTaskService.getArtifact(exec.taskId, exec.executionId);
        setArtifactContent(text);
      } catch (e) {
        setArtifactContent('Failed to load artifact from server.');
      } finally {
        setLoadingArtifact(false);
      }
    } else {
      setArtifactContent('No artifact generated for this execution.');
    }
  };

  const handleDelete = async (exec: AiTaskExecution) => {
    if (!confirm('Are you sure you want to permanently delete this execution and its artifact?')) return;
    try {
      await aiTaskService.deleteExecution(exec.executionId);
      setExecutions(executions.filter(e => e.executionId !== exec.executionId));
      if (selectedExec?.executionId === exec.executionId) {
        setSelectedExec(null);
        setArtifactContent(null);
      }
    } catch (e) {
      alert("Failed to delete execution: " + e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background animate-fade-in relative text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-surface/30 backdrop-blur-md sticky top-0 z-10">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Database className="text-primary w-8 h-8" /> Neural Archives
        </h1>
        <button onClick={loadData} className="px-4 py-2 bg-surface hover:bg-surface-hover rounded-xl text-sm font-bold uppercase tracking-widest border border-border transition-all">
          Sync DB
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* List Column */}
        <div className="w-1/3 border-r border-border bg-surface/10 overflow-y-auto custom-scrollbar flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Activity className="animate-spin text-primary opacity-50" />
            </div>
          ) : executions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground opacity-50 text-sm mt-10">
              No archives found.
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-2">
              {executions.map(exec => {
                const task = tasksMap[exec.taskId];
                const isSelected = selectedExec?.executionId === exec.executionId;
                return (
                  <div
                    key={exec.executionId}
                    onClick={() => handleSelect(exec)}
                    className={`p-4 rounded-xl cursor-pointer border transition-all hover:bg-surface-hover ${isSelected ? 'bg-primary/10 border-primary/30' : 'bg-surface border-border'}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold text-sm line-clamp-1">{task?.title || 'Unknown Task'}</div>
                      <div className={`text-[10px] px-2 py-0.5 rounded-md uppercase font-bold tracking-widest ${exec.status === 'completed' ? 'bg-success/10 text-success border border-success/20' : 'bg-warning/10 text-warning border border-warning/20'}`}>
                        {exec.status}
                      </div>
                    </div>
                    <div className="flex justify-between items-end text-xs text-muted-foreground">
                      <div className="flex flex-col gap-0.5">
                        <span>{exec.startedAt ? format(exec.startedAt, 'MMM dd, HH:mm') : 'Unknown'}</span>
                        {exec.completedAt && (
                          <span className="text-[9px] text-primary/40 font-black uppercase tracking-widest italic">
                            Duration: {Math.floor((exec.completedAt - (exec.startedAt || 0)) / 1000)}s
                          </span>
                        )}
                      </div>
                      {exec.artifactPath && <FileText size={12} className="text-primary opacity-80" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Content Column */}
        <div className="w-2/3 flex flex-col bg-background relative overflow-y-auto custom-scrollbar">
          {selectedExec ? (
            <div className="p-8 flex flex-col gap-6 max-w-4xl mx-auto w-full">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight mb-2">
                    {tasksMap[selectedExec.taskId]?.title || 'Execution Detail'}
                  </h2>
                  <div className="flex flex-wrap gap-4 text-xs font-mono text-muted-foreground uppercase opacity-80 mt-2">
                    <span className="bg-surface px-2 py-1 rounded">ID: {selectedExec.executionId.split('-')[0]}</span>
                    <span className="bg-surface px-2 py-1 rounded">START: {selectedExec.startedAt ? format(selectedExec.startedAt, 'PP pp') : 'N/A'}</span>
                    {selectedExec.completedAt && (
                      <span className="bg-surface px-2 py-1 rounded text-primary/80">FINISH: {format(selectedExec.completedAt, 'PP pp')}</span>
                    )}
                    {selectedExec.startedAt && selectedExec.completedAt && (
                      <span className="bg-primary/10 text-primary px-2 py-1 rounded font-black">DURATION: {Math.floor((selectedExec.completedAt - selectedExec.startedAt) / 1000)}s</span>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDelete(selectedExec)} className="p-2 bg-error/10 text-error hover:bg-error hover:text-white rounded-lg transition-all" title="Permanently Delete">
                  <Trash2 size={18} />
                </button>
              </div>

              {selectedExec.outputSummary && (
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl italic text-foreground opacity-90 text-sm">
                  {selectedExec.outputSummary}
                </div>
              )}

              <div className="mt-4">
                <ArtifactViewer
                  content={artifactContent}
                  isLoading={loadingArtifact}
                  format={selectedExec.artifactPath?.endsWith('.json') ? 'json' : 'markdown'}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30">
              <Database size={64} className="mb-4" />
              <p className="text-xl font-medium tracking-tight uppercase">Select an archive</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
