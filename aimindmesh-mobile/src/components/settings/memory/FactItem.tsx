import React, { useState } from 'react';
import { TrashIcon } from '../../../constants';
import { Fact, FACT_KINDS, FactKind, KIND_LABELS } from '../../../services/memory/facts/factTypes';
import { FactPatch } from '../../../services/memory/facts/factStore';
import { withCategory } from '../../../services/memory/manualMemories';

const SOURCE_LABEL: Record<Fact['source'], string> = {
    manual: 'You',
    migrated: 'You',
    imported: 'Backup',
    extracted: 'Learned',
    inline: 'Learned',
    tool: 'Learned',
};

const STATUS_LABEL: Record<Fact['status'], string> = {
    active: '',
    done: 'Done',
    superseded: 'Replaced',
    expired: 'Past',
    review: 'To review',
};

export const formatDay = (time: number) => new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

interface FactItemProps {
    fact: Fact;
    categories: string[];
    onUpdate: (id: string, patch: FactPatch) => void;
    onDelete: (id: string) => void;
}

/** One fact: tap the text to correct it; kind, label, pin and delete below */
export const FactItem: React.FC<FactItemProps> = ({ fact, categories, onUpdate, onDelete }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(fact.content);
    const active = fact.status === 'active';

    const save = () => {
        const text = draft.trim();
        if (text && text !== fact.content) onUpdate(fact.id, { content: text });
        setEditing(false);
    };

    return (
        <div className={`p-2 rounded bg-surface/40 hover:bg-surface/70 transition-colors ${active ? '' : 'opacity-60'}`}>
            {editing ? (
                <div className="space-y-1">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full bg-input border-surface rounded p-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => { setDraft(fact.content); setEditing(false); }} className="text-xs text-text-secondary px-2 py-1">Cancel</button>
                        <button onClick={save} className="text-xs bg-primary text-white rounded px-3 py-1">Save</button>
                    </div>
                </div>
            ) : (
                <p
                    className={`text-sm text-text-primary break-words ${active ? 'cursor-text' : 'line-through'}`}
                    onClick={() => active && setEditing(true)}
                >
                    {fact.subject && !fact.content.toLowerCase().includes(fact.subject.toLowerCase()) && (
                        <span className="font-semibold">{fact.subject}: </span>
                    )}
                    {fact.content}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-text-secondary">
                <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-bold">{SOURCE_LABEL[fact.source]}</span>
                {!active && <span className="px-1.5 py-0.5 rounded bg-white/10 font-bold">{STATUS_LABEL[fact.status]}</span>}
                {fact.dueAt && <span>📅 {formatDay(fact.dueAt)}</span>}
                {active && (
                    <>
                        <select
                            value={fact.kind}
                            onChange={(e) => onUpdate(fact.id, { kind: e.target.value as FactKind })}
                            className="bg-transparent text-primary border-none p-0 focus:ring-0 cursor-pointer"
                            aria-label="Kind"
                        >
                            {FACT_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                        </select>
                        <select
                            value={fact.category ?? ''}
                            onChange={(e) => onUpdate(fact.id, { category: e.target.value || undefined })}
                            className="bg-transparent text-text-secondary border-none p-0 focus:ring-0 cursor-pointer"
                            aria-label="Category"
                        >
                            <option value="">no label</option>
                            {(fact.category ? withCategory(categories, fact.category) : categories).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </>
                )}
                <span className="ml-auto flex items-center gap-2">
                    {active && (
                        <button
                            onClick={() => onUpdate(fact.id, { pinned: !fact.pinned })}
                            className={fact.pinned ? 'text-primary' : 'text-text-secondary/50 hover:text-text-secondary'}
                            title={fact.pinned ? 'Always remembered (tap to unpin)' : 'Pin: always remembered'}
                        >
                            📌
                        </button>
                    )}
                    <button onClick={() => onDelete(fact.id)} className="text-gray-500 hover:text-red-500" title="Forget"><TrashIcon /></button>
                </span>
            </div>
        </div>
    );
};
