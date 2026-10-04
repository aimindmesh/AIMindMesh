import React from 'react';
import { TrashIcon } from '../../../constants';
import { Fact, FactStatus, isOpenLoop } from '../../../services/memory/facts/factTypes';
import { formatDay } from './FactItem';

interface OpenLoopsListProps {
    facts: Fact[];
    onSetStatus: (id: string, status: FactStatus) => void;
    onDelete: (id: string) => void;
}

/** Things the user has to do and dates coming up, soonest first (undated ones last) */
export const OpenLoopsList: React.FC<OpenLoopsListProps> = ({ facts, onSetStatus, onDelete }) => {
    const loops = facts.filter(isOpenLoop).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt);
    if (loops.length === 0) return null;
    const now = Date.now();

    return (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-4">
            <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2">🧵 Open loops ({loops.length})</h4>
            <div className="space-y-1.5">
                {loops.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2 p-2 rounded bg-surface/40">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary break-words">
                                {fact.subject ? <span className="font-semibold">{fact.subject}: </span> : null}{fact.content}
                            </p>
                            <p className={`text-[10px] mt-0.5 ${fact.dueAt && fact.dueAt < now ? 'text-amber-300' : 'text-text-secondary'}`}>
                                {fact.kind === 'event' ? '📅' : '✅'} {fact.dueAt ? formatDay(fact.dueAt) : 'no date'}
                            </p>
                        </div>
                        <button
                            onClick={() => onSetStatus(fact.id, 'done')}
                            className="text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 flex-shrink-0"
                        >
                            Done
                        </button>
                        <button onClick={() => onDelete(fact.id)} className="text-gray-500 hover:text-red-500 flex-shrink-0" title="Forget"><TrashIcon /></button>
                    </div>
                ))}
            </div>
        </div>
    );
};
