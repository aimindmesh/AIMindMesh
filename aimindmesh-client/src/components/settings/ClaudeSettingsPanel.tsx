import { Sparkles } from 'lucide-react';
import type { ClaudeStatus } from '@aimindmesh/api-types';
import { CLAUDE_CATEGORIES, CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_STATE_LABEL } from '../admin/claude/claudeOptions';

const INPUT = 'bg-background p-3 rounded-lg border border-border font-mono outline-none focus:ring-2 focus:ring-primary transition-all';
const SELECT = 'bg-background p-2 rounded-lg border border-border outline-none focus:ring-2 focus:ring-primary transition-all font-mono text-sm';
const LABEL = 'text-sm font-semibold text-muted-foreground';
const CHECKBOX = 'w-5 h-5 rounded accent-primary border-border bg-background';

interface ClaudeSettingsPanelProps {
  /** The `claude` section of the server config, without the masked key */
  claude: any;
  onChange: (claude: any) => void;
  /** Claude state from GET /api/admin/status (undefined when the server is unreachable) */
  status?: ClaudeStatus;
}

/** Claude provider of the server: key, budget, models and effort per category, batches, agents. */
export function ClaudeSettingsPanel({ claude, onChange, status }: ClaudeSettingsPanelProps) {
  const c = claude ?? {};
  const set = (patch: any) => onChange({ ...c, ...patch });
  const setAgents = (patch: any) => set({ agents: { ...(c.agents ?? {}), ...patch } });
  const num = (value: string) => (value === '' ? undefined : Number(value));
  const spent = (status?.cycle.spendUsd ?? 0) + (status?.cycle.reservedUsd ?? 0);
  const ok = status?.state === 'ok';

  return (
    <div className="glass-panel rounded-2xl p-8 flex flex-col gap-6 max-w-2xl">
      <h2 className="text-xl font-semibold border-b border-border pb-2 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-primary" /> Anthropic Claude
      </h2>

      <div className={`text-sm rounded-lg px-3 py-2 border ${ok ? 'bg-success/10 border-success/30 text-success' : 'bg-secondary/20 border-border text-muted-foreground'}`}>
        <span className="font-semibold">{status ? CLAUDE_STATE_LABEL[status.state] : 'Status unknown'}</span>
        {status && <span> · ${spent.toFixed(2)} of ${(status.cycle.budgetUsd || 0).toFixed(2)} this cycle ({status.cycle.start} → {status.cycle.end})</span>}
        {status?.reason && <p className="text-xs mt-1 break-words">{status.reason}</p>}
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={c.enabled !== false} onChange={e => set({ enabled: e.target.checked })} className={CHECKBOX} />
        <span className="font-medium text-sm">Use Claude first until the monthly credit runs out</span>
      </label>

      <div className="flex flex-col gap-2">
        <label className={LABEL}>API Key</label>
        <input
          type="password"
          value={c.apiKey || ''}
          onChange={e => set({ apiKey: e.target.value })}
          className={INPUT}
          placeholder={status && status.state !== 'no_key' ? 'Key saved on the server (type to replace it)' : 'sk-ant-…'}
        />
        <p className="text-xs text-muted-foreground">Kept only on the server. Leave empty to keep the saved key.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className={LABEL}>Monthly budget (USD)</label>
          <input type="number" min={0} step={1} value={c.monthlyBudgetUsd ?? 200} onChange={e => set({ monthlyBudgetUsd: num(e.target.value) })} className={INPUT} />
        </div>
        <div className="flex flex-col gap-2">
          <label className={LABEL}>Renewal day</label>
          <input type="number" min={1} max={31} value={c.billingCycleDay ?? 29} onChange={e => set({ billingCycleDay: num(e.target.value) })} className={INPUT} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL}>Model and effort per category</label>
        {CLAUDE_CATEGORIES.map(cat => (
          <div key={cat.id} className="grid grid-cols-[110px_1fr_110px] gap-3 items-center">
            <span className="text-sm font-medium">{cat.label}</span>
            <select className={SELECT} value={c.models?.[cat.id] ?? cat.model} onChange={e => set({ models: { ...(c.models ?? {}), [cat.id]: e.target.value } })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select className={SELECT} value={c.effort?.[cat.id] ?? cat.effort} onChange={e => set({ effort: { ...(c.effort ?? {}), [cat.id]: e.target.value } })}>
              {CLAUDE_EFFORTS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-3 cursor-pointer" title="Scheduled background cycles (wiki, insight merge, proactive cycle, nightly evolution) use the Message Batches API at half price">
        <input type="checkbox" checked={c.batch?.enabled !== false} onChange={e => set({ batch: { ...(c.batch ?? {}), enabled: e.target.checked } })} className={CHECKBOX} />
        <span className="font-medium text-sm">Run scheduled background cycles as batches (−50%)</span>
      </label>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-bold uppercase tracking-widest opacity-40">Agents (OpenClaw, Hermes, venture builds)</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={c.agents?.enabled !== false} onChange={e => setAgents({ enabled: e.target.checked })} className={CHECKBOX} />
          <span className="font-medium text-sm">Agents use Claude first (FreeLLMAPI when it is unavailable)</span>
        </label>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <label className={LABEL}>Agent model</label>
            <select className={SELECT} value={c.agents?.model ?? 'claude-sonnet-5-5'} onChange={e => setAgents({ model: e.target.value })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className={LABEL}>Build model</label>
            <select className={SELECT} value={c.agents?.builderModel ?? 'claude-opus-5-5'} onChange={e => setAgents({ builderModel: e.target.value })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className={LABEL}>Agent budget (USD)</label>
            <input type="number" min={0} placeholder="shared" value={c.agents?.monthlyBudgetUsd ?? ''} onChange={e => setAgents({ monthlyBudgetUsd: e.target.value === '' ? null : Number(e.target.value) })} className={SELECT} />
          </div>
        </div>
      </div>
    </div>
  );
}
