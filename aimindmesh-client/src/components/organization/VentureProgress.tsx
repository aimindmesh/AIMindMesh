import { useState } from 'react';
import type { IdeaProposal, VentureDecision, VentureMilestone } from '../../services/organizationApi';

/** Milestones of a venture repository: done, current, and the acceptance criteria passing. */
export function MilestoneProgress({ milestones }: { milestones?: VentureMilestone[] }) {
  if (!milestones?.length) return null;
  const done = milestones.filter(m => m.status === 'done').length;
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-slate-400">Milestones: <strong className="text-slate-200">{done}/{milestones.length}</strong></div>
      <ul className="space-y-0.5">
        {milestones.map(m => (
          <li key={m.seq} className="text-[10px] flex items-center gap-2">
            <span>{m.status === 'done' ? '✅' : m.status === 'in_progress' ? '🔨' : '◻️'}</span>
            <span className={m.status === 'done' ? 'text-slate-400' : 'text-slate-200'}>M{m.seq} {m.title}</span>
            <span className="text-slate-500">
              {m.criteria.filter(c => m.passed.includes(c)).length}/{m.criteria.length} AC{m.attempts ? ` · ${m.attempts} run(s)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DECISIONS: { value: VentureDecision; label: string; hint: string; style: string }[] = [
  { value: 'continue', label: 'Continue', hint: 'New milestones from your notes', style: 'bg-emerald-600 hover:bg-emerald-500' },
  { value: 'pivot', label: 'Pivot', hint: 'Back to approval with a new spec', style: 'bg-amber-600 hover:bg-amber-500' },
  { value: 'kill', label: 'Close', hint: 'Stop the venture; the reason guides future discovery', style: 'bg-red-700 hover:bg-red-600' },
];

/** Owner's decision once the MVP is ready (closing is possible earlier too). */
export function VentureDecisionPanel({ idea, onDecide, busy }: {
  idea: Pick<IdeaProposal, 'status' | 'outcomeNotes'>;
  onDecide: (decision: VentureDecision, notes: string) => void;
  busy: boolean;
}) {
  const [notes, setNotes] = useState('');
  const available = DECISIONS.filter(d =>
    d.value === 'kill' ? !['killed', 'reviewing'].includes(idea.status) : idea.status === 'mvp_ready' || (d.value === 'pivot' && idea.status === 'development'));
  if (available.length === 0) return idea.outcomeNotes ? <p className="text-[11px] text-slate-400">Outcome: {idea.outcomeNotes}</p> : null;

  return (
    <div className="bg-slate-950/40 border border-white/10 rounded-2xl p-4 space-y-2">
      <span className="block text-[10px] text-slate-400 uppercase font-bold">
        {idea.status === 'mvp_ready' ? '🚀 MVP ready: what next?' : 'Venture decision'}
      </span>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        placeholder="Notes: what to build next, the new direction, or why it stops"
        className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
      />
      <div className="flex gap-2">
        {available.map(d => (
          <button
            key={d.value}
            title={d.hint}
            disabled={busy || (d.value !== 'kill' && !notes.trim())}
            onClick={() => onDecide(d.value, notes.trim())}
            className={`flex-1 py-1.5 text-white rounded-lg text-[10px] font-bold uppercase transition-all disabled:opacity-40 ${d.style}`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
