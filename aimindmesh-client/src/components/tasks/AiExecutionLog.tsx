/**
 * AiExecutionLog.tsx
 *
 * AI task execution table.
 * Includes integrated artifact viewer and approval button.
 */

import React, { useEffect, useState } from 'react';
import { useAiTaskStore } from '../../store/aiTaskStore';
import { aiTaskService } from '../../services/aiTaskService';
import { AiTaskExecution, EXECUTION_STATUS_CONFIG } from '../../types/aiTask';
import ArtifactViewer from './ArtifactViewer';

interface Props {
  taskId: string;
}

const AiExecutionLog: React.FC<Props> = ({ taskId }) => {
  const { executions, isLoadingExec, loadExecutions, approveExecution } = useAiTaskStore();
  const [expandedExec,  setExpandedExec]  = useState<string | null>(null);
  const [artifactText,  setArtifactText]  = useState<string | null>(null);
  const [loadingArtif,  setLoadingArtif]  = useState(false);

  useEffect(() => {
    loadExecutions(taskId);
    
    // Smart polling: every 5s while there are non-final tasks
    const interval = setInterval(() => {
      const store = useAiTaskStore.getState();
      const needsPoll = store.executions.some(e =>
        ['running', 'queued', 'scheduled'].includes(e.status)
      );
      if (needsPoll) loadExecutions(taskId);
    }, 5_000);
    
    return () => clearInterval(interval);
  }, [taskId, loadExecutions]);

  const handleExpand = async (exec: AiTaskExecution) => {
    if (expandedExec === exec.executionId) {
      setExpandedExec(null);
      setArtifactText(null);
      return;
    }
    setExpandedExec(exec.executionId);
    setArtifactText(null);

    if (exec.artifactPath) {
      setLoadingArtif(true);
      try {
        const text = await aiTaskService.getArtifact(taskId, exec.executionId);
        setArtifactText(text);
      } catch (err) {
        setArtifactText('Error: Unable to load artifact from server.');
      } finally {
        setLoadingArtif(false);
      }
    }
  };

  const formatTs = (ts?: number) => ts
    ? new Date(ts).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  const formatDuration = (start?: number, end?: number) => {
    if (!start || !end) return null;
    const diff = Math.floor((end - start) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  if (isLoadingExec && executions.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center py-12 opacity-50">
            <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-xs font-bold uppercase tracking-widest">Loading history...</p>
        </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="py-12 text-center bg-white/5 rounded-2xl border border-white/5 mx-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Log Empty</p>
          <p className="text-[11px] text-muted-foreground opacity-60">No executions recorded for this task yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-8">
      {executions.map(exec => {
        const cfg = EXECUTION_STATUS_CONFIG[exec.status];
        const isExpanded = expandedExec === exec.executionId;

        return (
          <div key={exec.executionId} className={`rounded-xl border transition-all duration-300 ${isExpanded ? 'border-primary/30 bg-primary/5' : 'border-white/5 hover:border-white/20 bg-background/50'}`}>

            {/* Row / Trigger */}
            <button
              type="button"
              onClick={() => handleExpand(exec)}
              className="w-full flex items-center justify-between px-4 py-4 text-left group"
            >
              <div className="flex items-center gap-4">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider border border-current ${cfg.color} ${cfg.bg} ${cfg.pulse ? 'animate-pulse' : ''}`}>
                  {cfg.label}
                </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground font-medium">{formatTs(exec.startedAt)}</span>
                    {exec.completedAt && (
                      <span className="text-[9px] text-primary/40 font-black uppercase tracking-widest italic">
                        Duration: {formatDuration(exec.startedAt, exec.completedAt)}
                      </span>
                    )}
                  </div>
                </div>
              <div className="text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity">
                {isExpanded ? '▲' : '▼'}
              </div>
            </button>

            {/* Child content (Expanded) */}
            {isExpanded && (
              <div className="border-t border-white/5 px-4 py-4 space-y-4 animate-fade-in">

                {exec.outputSummary && (
                  <div className="bg-background/50 p-3 rounded-lg border border-white/5 italic text-xs text-muted-foreground leading-relaxed">
                     "{exec.outputSummary}"
                  </div>
                )}

                {exec.errorMessage && (
                  <div className="text-[10px] font-mono text-error bg-error/10 p-3 rounded-lg border border-error/20 whitespace-pre-wrap">
                    FAILURE LOG: {exec.errorMessage}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[10px] uppercase font-bold tracking-tight">
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span className="text-muted-foreground">Started</span>
                    <span className="text-foreground">{formatTs(exec.startedAt)}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span className="text-muted-foreground">Finished</span>
                    <span className="text-foreground">{formatTs(exec.completedAt)}</span>
                  </div>
                  {exec.artifactPath && (
                    <div className="col-span-2 flex justify-between border-b border-white/5 pb-1">
                        <span className="text-muted-foreground">Storage ID</span>
                        <span className="text-primary font-mono lowercase tracking-normal">{exec.artifactPath}</span>
                    </div>
                  )}
                </div>

                {exec.giteaCommitUrl && (
                  <a
                    href={exec.giteaCommitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[10px] font-bold text-primary hover:text-primary-hover transition-colors uppercase tracking-widest bg-primary/10 w-fit px-3 py-1.5 rounded-md"
                  >
                    🐙 Gitea Commit Link →
                  </a>
                )}

                {/* Artifact viewer */}
                {exec.artifactPath && (
                  <ArtifactViewer
                    content={artifactText}
                    isLoading={loadingArtif}
                    format={exec.artifactPath.endsWith('.json') ? 'json' : 'markdown'}
                  />
                )}

                {/* Status-specific Actions */}
                {exec.status === 'needs_review' && (
                  <button
                    type="button"
                    onClick={() => approveExecution(taskId, exec.executionId)}
                    className="w-full py-3 text-xs font-bold bg-success hover:bg-success-hover text-surface rounded-xl transition-all shadow-lg active:scale-95 uppercase tracking-widest"
                  >
                    ✓ Verify & Approve Output
                  </button>
                )}

              </div>
            )}

          </div>
        );
      })}
    </div>
  );
};

export default AiExecutionLog;
