import { useEffect, useState } from 'react';
import { evolutionApi } from '../../services/api';
import type { EvolutionSourceStats } from '@aimindmesh/api-types';

export const sourceLabel = (source: string | null | undefined) => (source ?? '').replace(/_/g, ' ');

/** What each candidate source turned into: evidence that gets merged deserves more trust. */
export function EvolutionStatsCard() {
  const [stats, setStats] = useState<EvolutionSourceStats[] | null>(null);

  useEffect(() => {
    evolutionApi.getStats()
      .then(res => setStats((res.data as { sources: EvolutionSourceStats[] }).sources))
      .catch(() => setStats(null)); // older servers have no stats
  }, []);

  if (!stats?.length) return null;
  return (
    <div className="p-4 glass-panel rounded-2xl border border-white/5 space-y-2">
      <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Outcome by source</div>
      {stats.map(s => (
        <div key={s.source} className="flex justify-between text-[10px]">
          <span className="font-bold capitalize">{sourceLabel(s.source)}</span>
          <span className="text-muted-foreground">
            {s.candidates} cand. · {s.proposals} PR · <span className="text-success font-bold">{s.merged} merged</span> · {s.failed} failed
          </span>
        </div>
      ))}
    </div>
  );
}
