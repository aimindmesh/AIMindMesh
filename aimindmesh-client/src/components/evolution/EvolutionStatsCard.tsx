import { useEffect, useState } from 'react';
import { serverApi } from '../../services/serverApi';
import type { EvolutionSourceStats } from '@aimindmesh/api-types';

export const sourceLabel = (source: string | null | undefined) => (source ?? '').replace(/_/g, ' ');

/** What each candidate source turned into: evidence that gets merged deserves more trust. */
export function EvolutionStatsCard() {
  const [stats, setStats] = useState<EvolutionSourceStats[] | null>(null);

  useEffect(() => {
    serverApi.get<{ sources: EvolutionSourceStats[] }>('/api/evolution/stats')
      .then(res => setStats(res.data.sources))
      .catch(() => setStats(null)); // older servers have no stats
  }, []);

  if (!stats?.length) return null;
  return (
    <div className="glass-panel rounded-3xl border border-white/5 p-5">
      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-muted-foreground mb-3">Outcome by source</h3>
      <div className="grid grid-cols-7 gap-2 text-[11px]">
        {['Source', 'Candidates', 'Failed', 'Skipped', 'Proposals', 'Merged', 'Rejected'].map(h => (
          <div key={h} className="text-muted-foreground font-bold uppercase text-[9px]">{h}</div>
        ))}
        {stats.map(s => [
          <div key={`${s.source}-n`} className="font-bold capitalize">{sourceLabel(s.source)}</div>,
          <div key={`${s.source}-c`}>{s.candidates}</div>,
          <div key={`${s.source}-f`}>{s.failed}</div>,
          <div key={`${s.source}-s`}>{s.skipped}</div>,
          <div key={`${s.source}-p`}>{s.proposals}</div>,
          <div key={`${s.source}-m`} className="text-success font-bold">{s.merged}</div>,
          <div key={`${s.source}-r`}>{s.rejected}</div>,
        ])}
      </div>
    </div>
  );
}
