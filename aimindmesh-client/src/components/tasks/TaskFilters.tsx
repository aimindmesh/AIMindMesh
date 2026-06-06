/**
 * TaskFilters.tsx
 *
 * Barba di filtri per la TaskManagerView (PC Client).
 */

import React, { useState } from 'react';
import { AiTaskStatus, AiExecutionStatus } from '../../types/aiTask';

export interface PcTaskFilters {
  status?:          AiTaskStatus;
  executionStatus?: AiExecutionStatus;
  model?:           string;
  search?:          string;
}

interface Props {
  onChange: (filters: PcTaskFilters) => void;
}

const TaskFilters: React.FC<Props> = ({ onChange }) => {
  const [filters, setFilters] = useState<PcTaskFilters>({});

  const update = (patch: Partial<PcTaskFilters>) => {
    const next = { ...filters, ...patch };
    // Rimuovi chiavi vuote
    (Object.keys(next) as (keyof PcTaskFilters)[]).forEach(k => {
      if (next[k] === undefined || next[k] === '') delete next[k];
    });
    setFilters(next);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Search */}
      <div className="relative">
        <input
            type="text"
            placeholder="Search tasks..."
            onChange={e => update({ search: e.target.value.trim() || undefined })}
            className="px-4 py-2 bg-surface-hover border border-white/5 rounded-xl text-sm text-white placeholder-muted-foreground focus:ring-2 focus:ring-primary/50 outline-none w-64 transition-all shadow-inner"
        />
      </div>

      <div className="flex items-center gap-2">
          {/* Status */}
          <select
            value={filters.status ?? ''}
            onChange={e => update({ status: (e.target.value as AiTaskStatus) || undefined })}
            className="px-3 py-2 bg-surface-hover border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>

          {/* Execution status */}
          <select
            value={filters.executionStatus ?? ''}
            onChange={e => update({ executionStatus: (e.target.value as AiExecutionStatus) || undefined })}
            className="px-3 py-2 bg-surface-hover border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none"
          >
            <option value="">Sync State</option>
            <option value="scheduled">Scheduled</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="needs_review">Review Required</option>
          </select>

          {/* Model */}
          <select
            value={filters.model ?? ''}
            onChange={e => update({ model: e.target.value || undefined })}
            className="px-3 py-2 bg-surface-hover border border-white/5 rounded-xl text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none"
          >
            <option value="">All Models</option>
            <option value="auto">Auto</option>
            <option value="ollama">Ollama</option>
            <option value="gemini">Gemini</option>
            <option value="openclaw">OpenClaw</option>
          </select>
      </div>

      {Object.keys(filters).length > 0 && (
        <button
          onClick={() => { setFilters({}); onChange({}); }}
          className="text-[10px] font-bold text-primary hover:text-primary-hover transition-colors uppercase tracking-widest px-2"
        >
          × Clear Filters
        </button>
      )}
    </div>
  );
};

export default TaskFilters;
