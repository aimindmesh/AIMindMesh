import React from 'react';
import type { VentureRepository } from '../../services/organizationApi';

const BADGE = 'text-[8px] px-1.5 py-0.5 rounded font-bold uppercase border inline-block';

const IDEA_STYLES: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
  reviewing: 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse',
  characterized: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  development: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  mvp_ready: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  killed: 'bg-slate-500/10 text-slate-500 border-slate-500/20 line-through',
};

/** Status of a venture idea; unknown statuses render as neutral text. */
export const IdeaStatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`${BADGE} text-[9px] mt-0.5 ${IDEA_STYLES[status] ?? 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>{status}</span>
);

const REPO_LABELS: Record<string, [string, string]> = {
  pending: ['◷ Waiting', 'bg-slate-500/10 text-slate-300 border-slate-500/20'],
  healthy: ['✓ Built', 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'],
  broken: ['✗ Failed', 'bg-red-500/10 text-red-400 border-red-500/20'],
  cooldown: ['↻ Retry later', 'bg-amber-500/10 text-amber-400 border-amber-500/20'],
  blocked: ['⛔ Blocked', 'bg-red-500/15 text-red-300 border-red-500/30'],
  verifying: ['↻ Verifying', 'bg-purple-500/10 text-purple-400 border-purple-500/20'],
  needs_verification: ['↻ Verifying', 'bg-purple-500/10 text-purple-400 border-purple-500/20'],
};

/** Status of a venture repository: a run in progress wins; unknown statuses still show (never null). */
export const RepoStatusBadge: React.FC<{ repo: Pick<VentureRepository, 'validation_status' | 'isEvolving'> }> = ({ repo }) => {
  if (repo.isEvolving) return <span className={`${BADGE} bg-blue-500/10 text-blue-400 border-blue-500/20 animate-pulse`}>⚡ Building</span>;
  const [label, style] = REPO_LABELS[repo.validation_status] ?? [repo.validation_status, 'bg-slate-500/10 text-slate-400 border-slate-500/20'];
  return <span className={`${BADGE} ${style}`}>{label}</span>;
};
