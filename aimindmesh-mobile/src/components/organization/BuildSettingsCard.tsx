import React, { useEffect, useState } from 'react';
import type { VentureBuildConfig } from '../../services/organizationApi';

const INPUT = 'w-full bg-input border border-white/10 rounded-2xl px-3 py-2 text-xs text-text-primary';
const MINUTE = 60_000;

interface Props {
  config: VentureBuildConfig | null;
  loading: boolean;
  onSave: (patch: VentureBuildConfig) => void;
}

/** Venture build loop settings; "enabled" is the kill switch of every development run. */
export const BuildSettingsCard: React.FC<Props> = ({ config, loading, onSave }) => {
  const [form, setForm] = useState<VentureBuildConfig | null>(config);
  useEffect(() => { if (config) setForm({ ...config }); }, [config]);
  if (!form) return null;
  const set = (patch: Partial<VentureBuildConfig>) => setForm({ ...form, ...patch });

  return (
    <div className="rounded-3xl border border-white/5 bg-surface/40 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider">Development runs</h3>
        <label className="flex items-center gap-2 text-[10px] text-text-secondary uppercase font-bold">
          <input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })} />
          {form.enabled ? 'Enabled' : 'Off'}
        </label>
      </div>
      <p className="text-[10px] text-text-secondary">
        The server validates every run in a throw-away container and publishes it only if build and tests pass.
      </p>
      <label className="text-[10px] text-text-secondary">Model (empty = OpenClaw default)
        <input className={INPUT} value={form.model ?? ''} placeholder="default" onChange={e => set({ model: e.target.value.trim() || null })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-secondary">Attempts before blocking
          <input className={INPUT} type="number" min={1} max={20} value={form.maxAttempts} onChange={e => set({ maxAttempts: Number(e.target.value) })} />
        </label>
        <label className="text-[10px] text-text-secondary">Runs per day
          <input className={INPUT} type="number" min={1} max={100} value={form.dailyRunLimit} onChange={e => set({ dailyRunLimit: Number(e.target.value) })} />
        </label>
        <label className="text-[10px] text-text-secondary">Runs per venture
          <input className={INPUT} type="number" min={1} max={200} value={form.maxRunsPerVenture ?? 12} onChange={e => set({ maxRunsPerVenture: Number(e.target.value) })} />
        </label>
        <label className="text-[10px] text-text-secondary">Agent minutes per run
          <input className={INPUT} type="number" min={1} max={240} value={Math.round(form.agentRunTimeoutMs / MINUTE)} onChange={e => set({ agentRunTimeoutMs: Number(e.target.value) * MINUTE })} />
        </label>
        <label className="text-[10px] text-text-secondary">Validation minutes
          <input className={INPUT} type="number" min={1} max={120} value={Math.round(form.validationTimeoutMs / MINUTE)} onChange={e => set({ validationTimeoutMs: Number(e.target.value) * MINUTE })} />
        </label>
      </div>
      <button onClick={() => onSave(form)} disabled={loading} className="w-full bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs uppercase tracking-wider disabled:opacity-50">
        Save build settings
      </button>
    </div>
  );
};
