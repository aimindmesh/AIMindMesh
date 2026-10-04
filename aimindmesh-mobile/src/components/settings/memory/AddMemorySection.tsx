import React, { useState } from 'react';
import { triggerHaptic } from '../../../services/native';
import { FACT_KINDS, FactKind, KIND_LABELS, NewFact } from '../../../services/memory/facts/factTypes';
import { parseDueDate } from '../../../services/memory/facts/factConsolidator';

interface AddMemorySectionProps {
    onAddFact: (fact: NewFact) => void;
    memoryCategories: string[];
}

/** Tell the assistant something directly: always remembered (pinned) */
export const AddMemorySection: React.FC<AddMemorySectionProps> = ({ onAddFact, memoryCategories }) => {
    const [content, setContent] = useState('');
    const [kind, setKind] = useState<FactKind>('identity');
    const [category, setCategory] = useState('');
    const [due, setDue] = useState('');
    const dated = kind === 'commitment' || kind === 'event';

    const handleAdd = () => {
        if (!content.trim()) return;
        triggerHaptic();
        onAddFact({ content, kind, category: category || undefined, dueAt: dated ? parseDueDate(due) : undefined });
        setContent('');
        setDue('');
    };

    return (
        <div className="mb-4">
            <h3 className="text-sm font-medium text-text-primary mb-2">Tell me something about you</h3>
            <div className="flex flex-col space-y-2">
                <input
                    type="text"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="e.g., My wife is called Giulia."
                    className="block w-full bg-input border-surface rounded-md shadow-sm py-2 px-3 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <div className="flex flex-wrap gap-2">
                    <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as FactKind)}
                        className="bg-input border-surface rounded-md text-xs px-2 py-2 text-text-secondary focus:outline-none"
                        aria-label="Kind"
                    >
                        {FACT_KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                    </select>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="bg-input border-surface rounded-md text-xs px-2 py-2 text-text-secondary focus:outline-none"
                        aria-label="Category"
                    >
                        <option value="">no label</option>
                        {memoryCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    {dated && (
                        <input
                            type="date"
                            value={due}
                            onChange={(e) => setDue(e.target.value)}
                            className="bg-input border-surface rounded-md text-xs px-2 py-2 text-text-secondary focus:outline-none"
                            aria-label="Date"
                        />
                    )}
                    <button onClick={handleAdd} className="flex-1 min-w-[80px] bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary/80">Add</button>
                </div>
            </div>
        </div>
    );
};
