/**
 * TaskDetailPanel.tsx
 *
 * Side panel (desktop) for creating and editing AI tasks.
 * Replaces the mobile modal with a fixed panel on the right in the TaskManagerView.
 */

import React, { useState, useEffect } from 'react';
import {
  ServerAiTask, AiTaskCreatePayload, AiTaskUpdatePayload,
  AiModel, AiStoragePolicy, AiOutputFormat, CRON_PRESETS
} from '../../types/aiTask';
import { useAiTaskStore } from '../../store/aiTaskStore';
import AiExecutionLog from './AiExecutionLog';

interface Props {
  task: ServerAiTask | null;   // null = creation mode
  onClose: () => void;
}

const DEFAULT_PAYLOAD: AiTaskCreatePayload = {
  title:          '',
  promptTemplate: '',
  model:          'auto',
  outputFormat:   'markdown',
  storagePolicy:  'server_disk',
  requiresReview: true,
};

const TaskDetailPanel: React.FC<Props> = ({ task, onClose }) => {
  const { createTask, updateTask, deleteTask, pauseTask, resumeTask, runNow } = useAiTaskStore();

  const [form,         setForm]         = useState<AiTaskCreatePayload>(DEFAULT_PAYLOAD);
  const [cronPreset,   setCronPreset]   = useState<string>('');
  const [customCron,   setCustomCron]   = useState('');
  const [showCron,     setShowCron]     = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<'config' | 'logs'>('config');

  useEffect(() => {
    if (task) {
      setForm({
        title:          task.title,
        promptTemplate: task.promptTemplate,
        model:          task.model,
        outputFormat:   task.outputFormat,
        storagePolicy:  task.storagePolicy,
        requiresReview: task.requiresReview,
        cronExpression: task.cronExpression,
        scheduledAt:    task.scheduledAt,
      });
      if (task.cronExpression) {
        const preset = CRON_PRESETS.find(p => p.value === task.cronExpression);
        setCronPreset(preset ? preset.value : 'custom');
        if (!preset) {
            setCustomCron(task.cronExpression);
            setShowCron(true);
        } else {
            setShowCron(false);
        }
      } else {
        setCronPreset('');
        setShowCron(false);
      }
    } else {
      setForm(DEFAULT_PAYLOAD);
      setCronPreset('');
      setCustomCron('');
      setShowCron(false);
    }
    setError(null);
    setActiveTab('config');
  }, [task]);

  const handleCronChange = (value: string) => {
    setCronPreset(value);
    if (value === '') {
      setForm(f => ({ ...f, cronExpression: undefined }));
      setShowCron(false);
    } else if (value === 'custom') {
      setShowCron(true);
      setForm(f => ({ ...f, cronExpression: customCron || '0 7 * * *' }));
    } else {
      setShowCron(false);
      setForm(f => ({ ...f, cronExpression: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.title?.trim()) { setError('Title is mandatory'); return; }
    if (!form.promptTemplate?.trim()) { setError('AI Instructions (Prompt) are mandatory'); return; }

    setIsSubmitting(true);
    try {
      if (task) {
        const patch: AiTaskUpdatePayload = { ...form };
        await updateTask(task.id, patch);
      } else {
        await createTask(form);
      }
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Failure during persistence');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!confirm(`Permanently delete task "${task.title}"?`)) return;
    try {
      await deleteTask(task.id);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRunNow = async () => {
    if (!task) return;
    try {
      await runNow(task.id);
      // Immediate visual feedback via alert or local UI if necessary
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleTogglePause = async () => {
    if (!task) return;
    try {
      if (task.status === 'active') await pauseTask(task.id);
      else                          await resumeTask(task.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface border-l border-white/10 w-[420px] flex-shrink-0 animate-slide-in-right shadow-2xl z-20">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 bg-surface">
        <h2 className="text-sm font-bold text-white uppercase tracking-widest">
          {task ? 'Edit AI Architecture' : 'Draft New AI Task'}
        </h2>
        <button 
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/5 text-muted-foreground hover:text-white transition-all"
        >
            ×
        </button>
      </div>

      {/* Tab bar (edit mode only) ── */}
      {task && (
        <div className="flex border-b border-white/10 bg-surface-hover">
          {(['config', 'logs'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-all ${
                activeTab === tab
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {tab === 'config' ? '⚙️ Parameters' : '📋 Execution Logs'}
            </button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface/50">

        {activeTab === 'logs' && task ? (
          <div className="p-6">
            <AiExecutionLog taskId={task.id} />
          </div>
        ) : (
          <form id="ai-task-form" onSubmit={handleSubmit} className="p-6 space-y-6 animate-fade-in text-[11px]">

            {error && (
              <div className="px-4 py-3 bg-error/10 border border-error/20 rounded-xl text-error font-bold flex items-center gap-2">
                ⚠ {error}
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <label className="block font-bold text-muted-foreground uppercase tracking-wider">Functional Title</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-white placeholder-muted-foreground focus:ring-2 focus:ring-primary/50 outline-none transition-all shadow-inner"
                placeholder="e.g. Daily Tech Intelligence Briefing"
              />
            </div>

            {/* Prompt */}
            <div className="space-y-2">
              <label className="block font-bold text-muted-foreground uppercase tracking-wider">AI Instructions & System Prompt</label>
              <textarea
                value={form.promptTemplate}
                onChange={e => setForm(f => ({ ...f, promptTemplate: e.target.value }))}
                className="w-full px-4 py-3 bg-background border border-white/10 rounded-xl text-white placeholder-muted-foreground focus:ring-2 focus:ring-primary/50 outline-none transition-all shadow-inner font-mono leading-relaxed"
                rows={8}
                placeholder="Define the task objectives, constraints, and target output structure..."
              />
              <p className="text-[10px] text-muted-foreground opacity-50 px-1 italic">Use variables like {`{{last_results}}`} for chain processing.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                {/* Model */}
                <div className="space-y-2">
                <label className="block font-bold text-muted-foreground uppercase tracking-wider">Neural Model</label>
                <select
                    value={form.model}
                    onChange={e => setForm(f => ({ ...f, model: e.target.value as AiModel }))}
                    className="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-primary/50 outline-none transition-all cursor-pointer"
                >
                    <option value="auto">🔀 Auto Routing</option>
                    <option value="ollama">🦙 Server Ollama</option>
                    <option value="gemini">✨ Gemini 3.1</option>
                    <option value="openclaw">🔧 OpenClaw Agent</option>
                </select>
                </div>

                {/* Output format */}
                <div className="space-y-2">
                <label className="block font-bold text-muted-foreground uppercase tracking-wider">Output Schema</label>
                <select
                    value={form.outputFormat}
                    onChange={e => setForm(f => ({ ...f, outputFormat: e.target.value as AiOutputFormat }))}
                    className="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-primary/50 outline-none transition-all cursor-pointer"
                >
                    <option value="markdown">📝 Markdown</option>
                    <option value="plain">📄 Text Stream</option>
                    <option value="json">⚙️ JSON Struct</option>
                    <option value="pdf">📑 PDF Report</option>
                </select>
                </div>
            </div>

            {/* Cron */}
            <div className="space-y-2">
              <label className="block font-bold text-muted-foreground uppercase tracking-wider">Temporal Scheduling</label>
              <select
                value={cronPreset}
                onChange={e => handleCronChange(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-primary/50 outline-none transition-all cursor-pointer"
              >
                <option value="">▶ On-Demand Execution Only</option>
                {CRON_PRESETS.filter(p => p.value !== 'custom').map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
                <option value="custom">⚙ Advanced Cron Syntax...</option>
              </select>
              {showCron && (
                <input
                  type="text"
                  value={customCron}
                  onChange={e => {
                    const val = e.target.value;
                    setCustomCron(val);
                    setForm(f => ({ ...f, cronExpression: val }));
                  }}
                  className="mt-2 w-full px-4 py-2.5 bg-background border border-primary/20 rounded-xl text-white font-mono placeholder-muted-foreground focus:ring-1 focus:ring-primary shadow-inner"
                  placeholder="0 7 * * *  (Standard Linux Cron)"
                />
              )}
            </div>

            {/* Storage policy */}
            <div className="space-y-2">
              <label className="block font-bold text-muted-foreground uppercase tracking-wider">Persistence Archive</label>
              <select
                value={form.storagePolicy}
                onChange={e => setForm(f => ({ ...f, storagePolicy: e.target.value as AiStoragePolicy }))}
                className="w-full px-4 py-2.5 bg-background border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-primary/50 outline-none transition-all cursor-pointer"
              >
                <option value="server_disk">💾 Local Server Filesystem</option>
                <option value="server_disk_gitea">💾 Git Indexed (Gitea Repo)</option>
              </select>
            </div>

            {/* Requires review */}
            <label className="flex items-start gap-3 p-4 bg-background border border-white/5 rounded-2xl cursor-pointer hover:bg-white/5 transition-all group">
              <input
                type="checkbox"
                checked={form.requiresReview}
                onChange={e => setForm(f => ({ ...f, requiresReview: e.target.checked }))}
                className="w-4 h-4 mt-0.5 rounded border-white/10 bg-background text-primary focus:ring-primary/50"
              />
              <div className="flex-1">
                <span className="block font-bold text-white group-hover:text-primary transition-colors">Supervised Output Required</span>
                <span className="text-[10px] text-muted-foreground opacity-60 leading-tight">Artifacts will await manual verification before being indexed into the Knowledge Base.</span>
              </div>
            </label>

          </form>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-6 py-6 border-t border-white/10 bg-surface flex flex-col gap-3">
 
        {/* Action Bar for existing task */}
        {task && activeTab === 'config' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRunNow}
              className="flex-1 py-3 text-[10px] font-bold bg-primary/20 hover:bg-primary/30 text-primary rounded-xl border border-primary/30 transition-all uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2"
            >
              🚀 Fire Now
            </button>
            <button
              type="button"
              onClick={handleTogglePause}
              className={`flex-1 py-3 text-[10px] font-bold rounded-xl border transition-all uppercase tracking-widest active:scale-95 ${
                task.status === 'active'
                  ? 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20'
                  : 'bg-success/10 border-success/30 text-success hover:bg-success/20'
              }`}
            >
              {task.status === 'active' ? '⏸ Suspend' : '▶ Reactivate'}
            </button>
          </div>
        )}

        {/* Global actions: Save / Delete */}
        {activeTab === 'config' && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              {task && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-4 py-2 text-[10px] font-bold text-error/60 hover:text-error hover:bg-error/10 rounded-xl transition-all uppercase tracking-widest"
                >
                  Terminate Task
                </button>
              )}
            </div>
            <div className="flex gap-3 flex-1 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-[10px] font-bold text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all uppercase tracking-widest"
              >
                Abort
              </button>
              <button
                type="submit"
                form="ai-task-form"
                disabled={isSubmitting}
                className="px-8 py-3 text-[10px] font-bold text-surface bg-primary hover:bg-primary-hover rounded-xl transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-widest active:scale-95"
              >
                {isSubmitting ? 'Architecting...' : task ? 'Update Core' : 'Deploy Task'}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default TaskDetailPanel;
