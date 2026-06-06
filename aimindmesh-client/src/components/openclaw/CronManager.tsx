import React, { useEffect, useState } from 'react';
import { agentApi, CronJob } from '../../services/serverApi';
import { useOpenClawStore } from '../../store/openclawStore';

export const CronManager: React.FC = () => {
  const { cronJobs, setCronJobs } = useOpenClawStore();
  const [newSchedule, setNewSchedule] = useState('0 6 * * *');
  const [newTask, setNewTask] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const { data } = await agentApi.listCronJobs();
        setCronJobs(data.jobs);
      } catch (e) {
        console.error('Failed to fetch cron jobs', e);
      }
    };
    fetchJobs();
  }, [setCronJobs]);

  const createJob = async () => {
    if (!newTask.trim() || adding) return;
    setAdding(true);
    try {
      const { data } = await agentApi.createCronJob(newSchedule, newTask);
      setCronJobs([...cronJobs, data]);
      setNewTask('');
    } finally {
      setAdding(false);
    }
  };

  const toggleJob = async (job: CronJob) => {
    try {
      const { data } = await agentApi.toggleCronJob(job.id, !job.enabled);
      setCronJobs(cronJobs.map((j) => (j.id === job.id ? data : j)));
    } catch (e) {
      console.error('Failed to toggle job', e);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      await agentApi.deleteCronJob(id);
      setCronJobs(cronJobs.filter((j) => j.id !== id));
    } catch (e) {
      console.error('Failed to delete job', e);
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-end border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Scheduled Agent Tasks</h3>
          <p className="text-sm text-muted-foreground mt-1">Autonomous cron jobs execution on the cloud server.</p>
        </div>
        <div className="px-3 py-1 bg-surface-2 rounded-lg border border-border text-xs font-mono">
          {cronJobs.length} Jobs
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {cronJobs.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 bg-surface-offset/30 border border-dashed border-border rounded-xl opacity-60">
            <p className="text-sm">No scheduled tasks currently configured.</p>
          </div>
        )}
        {cronJobs.map((job) => (
          <div
            key={job.id}
            className={`rounded-xl p-5 border transition-all duration-300 flex flex-col gap-3 shadow-sm ${
              job.enabled ? 'bg-surface border-border hover:border-primary/40' : 'bg-surface-2 border-border/50 opacity-60 grayscale'
            }`}
          >
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <code className="text-xs font-bold font-mono px-2 py-1 bg-surface-offset rounded text-primary border border-border/50">
                    {job.schedule}
                  </code>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    ID: {job.id.slice(0, 8)}
                  </span>
                </div>
                <p className="text-sm font-medium mt-3 leading-relaxed">{job.task}</p>
                <div className="flex gap-4 mt-4" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-muted-foreground rounded-full" />
                    Last Run: {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-primary rounded-full" />
                    Next Run: {job.nextRun ? new Date(job.nextRun).toLocaleString() : 'Pending'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => toggleJob(job)}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                    job.enabled 
                      ? 'bg-success/10 text-success border-success/20 hover:bg-success/20' 
                      : 'bg-muted text-muted-foreground border-muted-foreground/20 hover:bg-muted/50'
                  }`}
                >
                  {job.enabled ? 'ACTIVE' : 'PAUSED'}
                </button>
                <button
                  onClick={() => deleteJob(job.id)}
                  className="rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-destructive border border-destructive/20 hover:bg-destructive/10 transition-colors"
                >
                  DELETE
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New job form */}
      <div className="rounded-xl p-6 bg-surface-2 border border-dashed border-border shadow-inner">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-bold uppercase tracking-widest text-primary">New Scheduled Task</span>
        </div>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-1">
              <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5 block">Cron Schedule (UTC)</label>
              <input
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono font-bold bg-surface border border-border focus:ring-2 focus:ring-primary/20 outline-none"
                placeholder="0 6 * * *"
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5 block">Task Description (Natural Language)</label>
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs bg-surface border border-border focus:ring-2 focus:ring-primary/20 outline-none"
                placeholder="Instruct the agent to perform actions periodically..."
              />
            </div>
          </div>
          <button
            onClick={createJob}
            disabled={adding || !newTask.trim()}
            className="self-end rounded-lg px-5 py-2 bg-primary text-primary-foreground font-bold text-xs shadow-lg shadow-primary/20 hover:shadow-primary/40 active:scale-95 disabled:opacity-50 transition-all uppercase tracking-widest"
          >
            {adding ? 'CREATING...' : 'SCHEDULE TASK'}
          </button>
        </div>
      </div>
    </div>
  );
};
