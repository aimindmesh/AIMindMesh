import { useEffect, useState } from 'react';
import { Sparkles, Bot } from 'lucide-react';
import { CLAUDE_CATEGORIES, CLAUDE_EFFORTS, CLAUDE_MODELS } from './claudeOptions';

const INPUT = 'w-full bg-surface border border-border rounded-2xl p-4 text-sm font-mono font-black outline-none focus:border-orange-500/50';
const SELECT = 'w-full bg-surface border border-border rounded-xl p-2 text-[11px] font-mono outline-none focus:border-orange-500/50';
const LABEL = 'text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1.5 block px-1';

interface ClaudeSettingsSectionProps {
  /** The `claude` section of the server config (apiKey comes back masked) */
  claude: any;
  /** Saves one setting, e.g. ('claude.monthlyBudgetUsd', 150) */
  update: (path: string, value: unknown) => void;
}

/** Claude provider settings: key, budget, models and effort per category, batches, agents. */
export function ClaudeSettingsSection({ claude, update }: ClaudeSettingsSectionProps) {
  const c = claude ?? {};
  // The key and the numbers are saved when the field is left, not on every keystroke
  const [apiKey, setApiKey] = useState(c.apiKey || '');
  const [budget, setBudget] = useState(String(c.monthlyBudgetUsd ?? 200));
  const [agentBudget, setAgentBudget] = useState(c.agents?.monthlyBudgetUsd == null ? '' : String(c.agents.monthlyBudgetUsd));
  useEffect(() => { setApiKey(c.apiKey || ''); }, [c.apiKey]);

  return (
    <div className="glass-panel rounded-3xl p-6 border border-orange-500/20 mb-4">
      <div className="flex items-center gap-2 mb-5">
        <Sparkles size={16} className="text-orange-400" />
        <h3 className="text-xs font-black uppercase tracking-widest">Anthropic Claude</h3>
      </div>

      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={c.enabled !== false} onChange={e => update('claude.enabled', e.target.checked)} className="w-5 h-5 rounded accent-orange-500 border-border bg-surface" />
          <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Claude first until the credit runs out</span>
        </label>

        <div>
          <label className={LABEL}>API Key</label>
          <input type="password" value={apiKey} placeholder="sk-ant-…" onChange={e => setApiKey(e.target.value)}
            onBlur={() => apiKey !== (c.apiKey || '') && update('claude.apiKey', apiKey)} className={INPUT} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Budget / month (USD)</label>
            <input type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)}
              onBlur={() => budget !== '' && update('claude.monthlyBudgetUsd', Number(budget))} className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Renewal day</label>
            <input type="number" min={1} max={31} defaultValue={c.billingCycleDay ?? 29}
              onBlur={e => update('claude.billingCycleDay', Number(e.target.value))} className={INPUT} />
          </div>
        </div>

        <div className="space-y-2">
          <label className={LABEL}>Model and effort per category</label>
          {CLAUDE_CATEGORIES.map(cat => (
            <div key={cat.id} className="grid grid-cols-[80px_1fr_72px] gap-2 items-center">
              <span className="text-[9px] font-black uppercase tracking-widest">{cat.label}</span>
              <select className={SELECT} value={c.models?.[cat.id] ?? cat.model} onChange={e => update(`claude.models.${cat.id}`, e.target.value)}>
                {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select className={SELECT} value={c.effort?.[cat.id] ?? cat.effort} onChange={e => update(`claude.effort.${cat.id}`, e.target.value)}>
                {CLAUDE_EFFORTS.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={c.batch?.enabled !== false} onChange={e => update('claude.batch.enabled', e.target.checked)} className="w-5 h-5 rounded accent-orange-500 border-border bg-surface" />
          <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Batch the scheduled cycles (−50%)</span>
        </label>

        <div className="border-t border-border/30 pt-4 space-y-3">
          <p className={`${LABEL} flex items-center gap-2`}><Bot size={12} className="text-orange-400" /> Agents · OpenClaw, Hermes, builds</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={c.agents?.enabled !== false} onChange={e => update('claude.agents.enabled', e.target.checked)} className="w-5 h-5 rounded accent-orange-500 border-border bg-surface" />
            <span className="font-bold text-[10px] uppercase tracking-widest text-muted-foreground">Agents use Claude first</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Agent model</label>
              <select className={SELECT} value={c.agents?.model ?? 'claude-sonnet-5-5'} onChange={e => update('claude.agents.model', e.target.value)}>
                {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>Build model</label>
              <select className={SELECT} value={c.agents?.builderModel ?? 'claude-opus-5-5'} onChange={e => update('claude.agents.builderModel', e.target.value)}>
                {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL}>Agent budget / month (empty = shared)</label>
            <input type="number" min={0} value={agentBudget} placeholder="shared" onChange={e => setAgentBudget(e.target.value)}
              onBlur={() => update('claude.agents.monthlyBudgetUsd', agentBudget === '' ? null : Number(agentBudget))} className={INPUT} />
          </div>
        </div>
      </div>
    </div>
  );
}
