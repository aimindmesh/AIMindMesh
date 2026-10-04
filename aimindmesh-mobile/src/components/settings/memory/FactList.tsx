import React, { useMemo, useState } from 'react';
import { Fact, FACT_KINDS, KIND_LABELS, isOpenLoop, normalizeFactText } from '../../../services/memory/facts/factTypes';
import { FactPatch } from '../../../services/memory/facts/factStore';
import { FactItem } from './FactItem';

interface FactListProps {
    facts: Fact[];
    categories: string[];
    viewCategory: string;
    onUpdate: (id: string, patch: FactPatch) => void;
    onDelete: (id: string) => void;
}

/** What the assistant knows, grouped by kind; open loops have their own list */
export const FactList: React.FC<FactListProps> = ({ facts, categories, viewCategory, onUpdate, onDelete }) => {
    const [query, setQuery] = useState('');
    const [showHistory, setShowHistory] = useState(false);

    const visible = useMemo(() => {
        const q = normalizeFactText(query);
        return facts.filter(f =>
            (showHistory ? f.status !== 'active' : f.status === 'active' && !isOpenLoop(f))
            && (viewCategory === 'all' || f.category === viewCategory)
            && (!q || normalizeFactText(`${f.subject ?? ''} ${f.content}`).includes(q)));
    }, [facts, query, showHistory, viewCategory]);

    const groups = FACT_KINDS
        .map(kind => ({
            kind,
            items: visible.filter(f => f.kind === kind)
                .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance || b.updatedAt - a.updatedAt),
        }))
        .filter(g => g.items.length > 0);
    const historyCount = facts.filter(f => f.status !== 'active').length;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search what I know…"
                    className="flex-1 bg-input border-surface rounded-md py-1.5 px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {historyCount > 0 && (
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`text-[11px] px-2 py-1 rounded ${showHistory ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}
                    >
                        History ({historyCount})
                    </button>
                )}
            </div>

            {groups.length === 0 && (
                <p className="text-xs text-text-secondary/60 italic p-2">
                    {showHistory ? 'Nothing replaced or closed yet.' : 'Nothing yet: tell me about yourself in the chat, or add something below.'}
                </p>
            )}

            {groups.map(({ kind, items }) => (
                <div key={kind}>
                    <h5 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 pl-1">
                        {KIND_LABELS[kind]} ({items.length})
                    </h5>
                    <div className="space-y-1.5">
                        {items.map(fact => (
                            <FactItem key={fact.id} fact={fact} categories={categories} onUpdate={onUpdate} onDelete={onDelete} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};
