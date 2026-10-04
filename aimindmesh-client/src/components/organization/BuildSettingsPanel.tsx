import { useEffect, useState } from 'react';
import { useOrganizationStore } from '../../store/organizationStore';
import type { VentureBuildConfig } from '../../services/organizationApi';

const INPUT = 'w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200';
const MINUTE = 60_000;

/** Venture build loop settings; "enabled" is the kill switch of every development run. */
export function BuildSettingsPanel() {
  const { buildConfig, fetchBuildConfig, updateBuildConfig, loading } = useOrganizationStore();
  const [form, setForm] = useState<VentureBuildConfig | null>(null);

  useEffect(() => { fetchBuildConfig(); }, [fetchBuildConfig]);
  useEffect(() => { if (buildConfig) setForm({ ...buildConfig }); }, [buildConfig]);

  if (!form) return null;
  const set = (patch: Partial<VentureBuildConfig>) => setForm({ ...form, ...patch });

  return (
    <div className="p-5 bg-slate-900/40 border border-white/5 rounded-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Development runs</h3>
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input type="checkbox" checked={form.enabled} onChange={e => set({ enabled: e.target.checked })} />
          {form.enabled ? 'Enabled' : 'Disabled (kill switch)'}
        </label>
      </div>
      <p className="text-[10px] text-slate-500">
        The agent works without credentials; the server validates every run in a throw-away container and publishes it only if build and tests pass.
      </p>
      <div className="grid grid-cols-2 gap-3 text-[10px] text-slate-400">
        <label className="col-span-2 space-y-1">Model (empty = OpenClaw default)
          <input className={INPUT} value={form.model ?? ''} placeholder="default" onChange={e => set({ model: e.target.value.trim() || null })} />
        </label>
        <label className="space-y-1">Attempts before blocking
          <input className={INPUT} type="number" min={1} max={20} value={form.maxAttempts} onChange={e => set({ maxAttempts: Number(e.target.value) })} />
        </label>
        <label className="space-y-1">Runs per day
          <input className={INPUT} type="number" min={1} max={100} value={form.dailyRunLimit} onChange={e => set({ dailyRunLimit: Number(e.target.value) })} />
        </label>
        <label className="space-y-1">Runs per venture
          <input className={INPUT} type="number" min={1} max={200} value={form.maxRunsPerVenture ?? 12} onChange={e => set({ maxRunsPerVenture: Number(e.target.value) })} />
        </label>
        <label className="space-y-1">Agent time per run (min)
          <input className={INPUT} type="number" min={1} max={240} value={Math.round(form.agentRunTimeoutMs / MINUTE)} onChange={e => set({ agentRunTimeoutMs: Number(e.target.value) * MINUTE })} />
        </label>
        <label className="space-y-1">Validation time (min)
          <input className={INPUT} type="number" min={1} max={120} value={Math.round(form.validationTimeoutMs / MINUTE)} onChange={e => set({ validationTimeoutMs: Number(e.target.value) * MINUTE })} />
        </label>
        <label className="col-span-2 space-y-1">Validation image
          <input className={INPUT} value={form.validationImage} onChange={e => set({ validationImage: e.target.value })} />
        </label>
      </div>
      <button
        onClick={() => updateBuildConfig(form)}
        disabled={loading}
        className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase transition-all disabled:opacity-50"
      >
        Save build settings
      </button>
    </div>
  );
}
