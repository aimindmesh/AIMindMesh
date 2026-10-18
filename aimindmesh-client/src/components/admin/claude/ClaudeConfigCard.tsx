import { Sparkles, Key, Bot } from 'lucide-react';
import { CLAUDE_CATEGORIES, CLAUDE_EFFORTS, CLAUDE_MODELS } from './claudeOptions';

const INPUT = 'w-full bg-surface border border-border rounded-2xl p-4 outline-none focus:border-orange-500 font-mono font-black text-sm shadow-inner transition-all hover:border-orange-500/40';
const SELECT = 'w-full bg-surface border border-border rounded-xl p-2 outline-none focus:border-orange-500 font-mono text-xs';
const LABEL = 'text-[11px] font-black text-muted-foreground uppercase tracking-widest ml-1 italic';

interface ClaudeConfigCardProps {
  /** The `claude` section of the server config (apiKey comes back masked) */
  config: any;
  onChange: (claude: any) => void;
}

/** Claude provider settings: key, models and effort per category, budget, batches, agents. */
export function ClaudeConfigCard({ config, onChange }: ClaudeConfigCardProps) {
  const c = config ?? {};
  const set = (patch: any) => onChange({ ...c, ...patch });
  const setAgents = (patch: any) => set({ agents: { ...(c.agents ?? {}), ...patch } });
  const num = (value: string) => (value === '' ? undefined : Number(value));

  return (
    <div className="glass-panel p-8 rounded-[48px] border-orange-500/10 flex flex-col gap-8 group/cfg relative bg-[#070a14]/[0.4]">
      <div className="flex items-center gap-4">
        <div className="p-4 bg-orange-500/10 rounded-3xl text-orange-400 shadow-lg shadow-orange-500/5 group-hover/cfg:scale-110 transition-transform">
          <Sparkles size={24} />
        </div>
        <div>
          <h4 className="font-black text-lg tracking-tight uppercase italic underline decoration-orange-500/40 decoration-4 underline-offset-8">Anthropic Claude</h4>
          <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-2 opacity-60 italic">Monthly API credit · first choice until it runs out</p>
        </div>
      </div>

      <div className="space-y-3">
        <label className={`${LABEL} flex items-center gap-2`}><Key size={12} className="text-orange-400" /> API Key</label>
        <input type="password" placeholder="sk-ant-…" value={c.apiKey || ''} onChange={e => set({ apiKey: e.target.value })} className={INPUT} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className={LABEL}>Monthly budget (USD)</label>
          <input type="number" min={0} step={1} value={c.monthlyBudgetUsd ?? 200} onChange={e => set({ monthlyBudgetUsd: num(e.target.value) })} className={INPUT} />
        </div>
        <div className="space-y-3">
          <label className={LABEL}>Renewal day</label>
          <input type="number" min={1} max={31} value={c.billingCycleDay ?? 29} onChange={e => set({ billingCycleDay: num(e.target.value) })} className={INPUT} />
        </div>
      </div>

      <div className="space-y-2">
        <p className={LABEL}>Model and effort per category</p>
        {CLAUDE_CATEGORIES.map(cat => (
          <div key={cat.id} className="grid grid-cols-[110px_1fr_110px] gap-3 items-center">
            <span className="text-[11px] font-black uppercase tracking-widest">{cat.label}</span>
            <select className={SELECT} value={c.models?.[cat.id] ?? cat.model} onChange={e => set({ models: { ...(c.models ?? {}), [cat.id]: e.target.value } })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select className={SELECT} value={c.effort?.[cat.id] ?? cat.effort} onChange={e => set({ effort: { ...(c.effort ?? {}), [cat.id]: e.target.value } })}>
              {CLAUDE_EFFORTS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={c.enabled !== false} onChange={e => set({ enabled: e.target.checked })} className="w-5 h-5 rounded accent-orange-500 bg-surface border-border" />
          <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic">Enable Claude</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer" title="Scheduled background cycles (wiki, insight merge, proactive cycle, nightly evolution) use the Message Batches API at half price">
          <input type="checkbox" checked={c.batch?.enabled !== false} onChange={e => set({ batch: { ...(c.batch ?? {}), enabled: e.target.checked } })} className="w-5 h-5 rounded accent-orange-500 bg-surface border-border" />
          <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic">Batch background cycles (−50%)</span>
        </label>
      </div>

      <div className="space-y-4 border-t border-border/40 pt-6">
        <p className={`${LABEL} flex items-center gap-2`}><Bot size={12} className="text-orange-400" /> Agents (OpenClaw, Hermes, venture builds)</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={c.agents?.enabled !== false} onChange={e => setAgents({ enabled: e.target.checked })} className="w-5 h-5 rounded accent-orange-500 bg-surface border-border" />
          <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground italic">Agents use Claude first (FreeLLMAPI when it is unavailable)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className={LABEL}>Agent model</label>
            <select className={SELECT} value={c.agents?.model ?? 'claude-sonnet-5-5'} onChange={e => setAgents({ model: e.target.value })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className={LABEL}>Build model</label>
            <select className={SELECT} value={c.agents?.builderModel ?? 'claude-opus-5-5'} onChange={e => setAgents({ builderModel: e.target.value })}>
              {CLAUDE_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className={LABEL}>Agent budget (USD)</label>
            <input type="number" min={0} placeholder="shared" value={c.agents?.monthlyBudgetUsd ?? ''} onChange={e => setAgents({ monthlyBudgetUsd: e.target.value === '' ? null : Number(e.target.value) })} className={SELECT} />
          </div>
        </div>
      </div>
    </div>
  );
}
