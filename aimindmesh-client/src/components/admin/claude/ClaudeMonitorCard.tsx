import { Sparkles, Layers, Clock } from 'lucide-react';
import type { ClaudeStatus } from '@aimindmesh/api-types';
import { CLAUDE_STATE_LABEL } from './claudeOptions';

const usd = (n: number) => `$${n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/** Claude credit, budget and token usage of the current billing cycle. */
export function ClaudeMonitorCard({ status }: { status?: ClaudeStatus }) {
  const ok = status?.state === 'ok';
  const spent = (status?.cycle.spendUsd ?? 0) + (status?.cycle.reservedUsd ?? 0);
  const budget = status?.cycle.budgetUsd || 0;
  const percent = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const t = status?.today;
  const promptTokens = (t?.inputTokens ?? 0) + (t?.cacheReadTokens ?? 0) + (t?.cacheWriteTokens ?? 0);
  const cacheHit = promptTokens > 0 ? Math.round(((t?.cacheReadTokens ?? 0) / promptTokens) * 100) : 0;

  return (
    <div className={`glass-panel p-8 rounded-[40px] flex flex-col justify-between group relative overflow-hidden ${ok ? 'bg-orange-500/5 border-orange-500/20' : 'bg-surface/40 border-border/40'}`}>
      <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.1] transition-all duration-700">
        <Sparkles size={140} />
      </div>
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className={`p-4 rounded-3xl shadow-xl ${ok ? 'bg-orange-500 text-white shadow-orange-500/30' : 'bg-surface text-muted-foreground'}`}>
          <Sparkles size={24} />
        </div>
        <span className={`px-4 py-1.5 bg-surface border rounded-[14px] text-[10px] font-black uppercase tracking-[0.2em] italic ${ok ? 'border-orange-500/30 text-orange-400' : 'border-error/30 text-error'}`}>
          {status ? CLAUDE_STATE_LABEL[status.state] : 'Unknown'}
        </span>
      </div>
      <div className="relative z-10">
        <h3 className="text-muted-foreground text-[11px] font-black uppercase tracking-[0.2em] mb-2 italic">API Credit (cycle {status?.cycle.start ?? '—'} → {status?.cycle.end ?? '—'})</h3>
        <p className="text-3xl font-black tracking-tighter italic">{usd(spent)} <span className="text-sm font-bold text-muted-foreground opacity-60">/ {usd(budget)}</span></p>
        <div className="mt-4 h-2 bg-surface rounded-full overflow-hidden border border-border/40 shadow-inner">
          <div className={`h-full transition-all duration-1000 ${percent > 90 ? 'bg-error' : 'bg-orange-500'}`} style={{ width: `${percent}%` }} />
        </div>
        {status?.reason && <p className="mt-3 text-[10px] font-bold text-error/80 break-words">{status.reason}</p>}
        {status?.nextProbeAt && (
          <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Clock size={12} /> Next check {new Date(status.nextProbeAt).toLocaleString()}
          </p>
        )}
        <div className="mt-6 grid grid-cols-3 gap-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <div><p className="opacity-60">Router</p><p className="text-foreground font-mono">{usd(status?.cycle.bySource.router ?? 0)}</p></div>
          <div><p className="opacity-60">Agents</p><p className="text-foreground font-mono">{usd(status?.cycle.bySource.agent ?? 0)}</p></div>
          <div><p className="opacity-60">Builds</p><p className="text-foreground font-mono">{usd(status?.cycle.bySource.builder ?? 0)}</p></div>
          <div><p className="opacity-60">Today</p><p className="text-foreground font-mono">{t?.calls ?? 0} calls</p></div>
          <div><p className="opacity-60">Tokens in/out</p><p className="text-foreground font-mono">{tokens(promptTokens)} / {tokens(t?.outputTokens ?? 0)}</p></div>
          <div><p className="opacity-60">Cache hit</p><p className="text-foreground font-mono">{cacheHit}%</p></div>
        </div>
        <p className="mt-4 text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-50 flex items-center gap-2">
          <Layers size={12} /> {status?.inFlight.router ?? 0} running · {status?.inFlight.agents ?? 0} agent · {status?.pendingBatchRequests ?? 0} in batch
        </p>
      </div>
    </div>
  );
}
