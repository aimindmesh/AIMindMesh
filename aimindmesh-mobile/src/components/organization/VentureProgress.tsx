import React, { useState } from 'react';
import type { IdeaProposal, VentureDecision, VentureMilestone } from '../../services/organizationApi';

/** Milestones of a venture repository: done, current, and the acceptance criteria passing. */
export const MilestoneProgress: React.FC<{ milestones?: VentureMilestone[] }> = ({ milestones }) => {
  if (!milestones?.length) return null;
  const done = milestones.filter(m => m.status === 'done').length;
  return (
    <div className="space-y-1 mt-1">
      <div className="text-[10px] text-text-secondary">Milestones: <strong className="text-text-primary">{done}/{milestones.length}</strong></div>
      {milestones.map(m => (
        <div key={m.seq} className="text-[10px] text-text-secondary flex gap-1.5">
          <span>{m.status === 'done' ? '✅' : m.status === 'in_progress' ? '🔨' : '◻️'}</span>
          <span className="text-text-primary">M{m.seq} {m.title}</span>
          <span>{m.criteria.filter(c => m.passed.includes(c)).length}/{m.criteria.length} AC</span>
        </div>
      ))}
    </div>
  );
};

const DECISIONS: { value: VentureDecision; label: string; style: string }[] = [
  { value: 'continue', label: 'Continue', style: 'bg-emerald-600' },
  { value: 'pivot', label: 'Pivot', style: 'bg-amber-600' },
  { value: 'kill', label: 'Close', style: 'bg-red-700' },
];

/** Owner's decision once the MVP is ready (closing is possible earlier too). */
export const VentureDecisionPanel: React.FC<{
  idea: Pick<IdeaProposal, 'status' | 'outcomeNotes'>;
  busy: boolean;
  onDecide: (decision: VentureDecision, notes: string) => void;
}> = ({ idea, busy, onDecide }) => {
  const [notes, setNotes] = useState('');
  const available = DECISIONS.filter(d =>
    d.value === 'kill' ? !['killed', 'reviewing'].includes(idea.status) : idea.status === 'mvp_ready' || (d.value === 'pivot' && idea.status === 'development'));
  if (available.length === 0) return idea.outcomeNotes ? <p className="text-[10px] text-text-secondary">Outcome: {idea.outcomeNotes}</p> : null;
  return (
    <div className="bg-black/20 p-4 rounded-2xl border border-white/10 space-y-2">
      <span className="text-[9px] text-text-secondary uppercase font-bold block">{idea.status === 'mvp_ready' ? '🚀 MVP ready: what next?' : 'Venture decision'}</span>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder="What to build next, the new direction, or why it stops"
        className="w-full bg-input border border-white/10 rounded-xl px-3 py-2 text-xs text-text-primary resize-none" />
      <div className="flex gap-2">
        {available.map(d => (
          <button key={d.value} disabled={busy || (d.value !== 'kill' && !notes.trim())} onClick={() => onDecide(d.value, notes.trim())}
            className={`flex-1 py-2 text-white rounded-xl text-[10px] font-bold uppercase disabled:opacity-40 ${d.style}`}>{d.label}</button>
        ))}
      </div>
    </div>
  );
};
