/**
 * TaskCard.tsx
 *
 * Visualizzazione a card di un AI Task.
 */

import React, { useState } from 'react';
import { ServerAiTask, EXECUTION_STATUS_CONFIG } from '../../types/aiTask';
import { useAiTaskStore } from '../../store/aiTaskStore';
import { Trash2 } from 'lucide-react';

interface Props {
  task: ServerAiTask;
  selected?: boolean;
  onClick: () => void;
}

const TaskCard: React.FC<Props> = ({ task, selected, onClick }) => {
  const { deleteTask, loadTasks } = useAiTaskStore();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Permanently delete task "${task.title}"?`)) {
      setIsDeleting(true);
      try {
        await deleteTask(task.id);
        loadTasks();
      } catch (err) {
        alert('Failed to delete task');
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const exec = task.lastExecution;
  const execCfg = exec ? EXECUTION_STATUS_CONFIG[exec.status] : null;

  return (
    <div
      onClick={onClick}
      className={`group p-4 rounded-xl border cursor-pointer transition-all duration-200 hover:shadow-lg ${
        selected
          ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary/20'
          : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-white line-clamp-2 flex-1">{task.title}</p>
        <button 
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
          title="Delete this task"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Model + format */}
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-muted-foreground mb-3 tracking-tight">
        <span className="flex items-center gap-1">🤖 {task.model}</span>
        <span className="opacity-30">|</span>
        <span>{task.outputFormat}</span>
        {task.cronExpression && (
          <>
            <span className="opacity-30">|</span>
            <span className="flex items-center gap-1">🔁 {task.cronExpression}</span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto">
        {/* Execution status */}
        {execCfg ? (
          <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${execCfg.color} ${execCfg.bg} border border-current opacity-90 ${execCfg.pulse ? 'animate-pulse' : ''}`}>
            {execCfg.label}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground italic font-medium">Never executed</span>
        )}

        {/* Timestamp */}
        {exec?.updatedAt && (
            <span className="text-[10px] text-muted-foreground opacity-60 font-mono">
                {new Date(exec.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        )}
      </div>

      {/* Output summary */}
      {exec?.outputSummary && (
        <div className="mt-3 pt-3 border-t border-white/5">
            <p className="text-[11px] text-muted-foreground italic line-clamp-2 font-medium leading-relaxed">
                "{exec.outputSummary}"
            </p>
        </div>
      )}
    </div>
  );
};

export default TaskCard;
