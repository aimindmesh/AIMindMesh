import { Sparkles } from 'lucide-react';
import type { ClaudeStatus } from '@aimindmesh/api-types';
import { CLAUDE_STATE_LABEL } from './claudeOptions';

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Cockpit metric: Claude credit spent in the billing cycle against the budget. */
export function ClaudeCreditCard({ status }: { status?: ClaudeStatus }) {
  const spent = (status?.cycle.spendUsd ?? 0) + (status?.cycle.reservedUsd ?? 0);
  const budget = status?.cycle.budgetUsd || 0;
  const percent = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const ok = status?.state === 'ok';
  const t = status?.today;
  const promptTokens = (t?.inputTokens ?? 0) + (t?.cacheReadTokens ?? 0) + (t?.cacheWriteTokens ?? 0);
  const cacheHit = promptTokens > 0 ? Math.round(((t?.cacheReadTokens ?? 0) / promptTokens) * 100) : 0;

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-orange-400 opacity-70" />
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Claude</span>
        </div>
        <span className={`text-[8px] font-black uppercase tracking-widest ${ok ? 'text-orange-400' : 'text-error'}`}>
          {status ? CLAUDE_STATE_LABEL[status.state] : '--'}
        </span>
      </div>
      <p className="text-2xl font-black font-mono">
        <span className="text-sm text-orange-400 mr-1">$</span>
        {spent.toFixed(2)}
        <span className="text-sm text-muted-foreground"> / {budget.toFixed(0)}</span>
      </p>
      <div className="h-1 bg-surface-hover rounded-full mt-2 overflow-hidden border border-border/10">
        <div className={`h-full rounded-full transition-all duration-1000 ${percent > 90 ? 'bg-error' : 'bg-orange-400'}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between items-end mt-1">
        <p className="text-[10px] text-muted-foreground">Today {t?.calls ?? 0} calls · cache {cacheHit}%</p>
        <p className="text-[8px] font-bold text-muted-foreground/50 uppercase">
          agents {usd((status?.cycle.bySource.agent ?? 0) + (status?.cycle.bySource.builder ?? 0))}
        </p>
      </div>
      {status?.reason && <p className="text-[9px] text-error/80 mt-1 break-words">{status.reason}</p>}
    </div>
  );
}
