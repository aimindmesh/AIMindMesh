import React, { useEffect, useState } from 'react';
import { TrashIcon } from '../../../constants';
import { Fact, FactStatus } from '../../../services/memory/facts/factTypes';
import { logger } from '../../../services/logger';

interface ReviewListProps {
    facts: Fact[];
    onSetStatus: (id: string, status: FactStatus) => void;
    onDelete: (id: string) => void;
    /** Conversation memory on: the raw chat turns stored by older versions can be removed */
    semanticMemory: boolean;
}

/**
 * Memories older versions stored without checks, waiting for the user's decision: facts the
 * gate would refuse now (out of the prompt meanwhile) and the raw chat turns of the conversation
 * memory (now replaced by summaries). Nothing here is deleted unless the user asks.
 */
export const ReviewList: React.FC<ReviewListProps> = ({ facts, onSetStatus, onDelete, semanticMemory }) => {
    const toReview = facts.filter(f => f.status === 'review');
    const [rawCount, setRawCount] = useState(0);

    useEffect(() => {
        if (!semanticMemory) return;
        import('../../../services/memory/memoryDatabase')
            .then(db => db.countRawMemories())
            .then(setRawCount)
            .catch(e => logger.log('debug', '[Memory] Raw conversation rows not counted', e));
    }, [semanticMemory]);

    const deleteRaw = async () => {
        if (!window.confirm(`Delete ${rawCount} raw chat messages from the conversation memory? Summaries and facts stay.`)) return;
        const { deleteRawMemories } = await import('../../../services/memory/memoryDatabase');
        await deleteRawMemories();
        setRawCount(0);
    };

    if (toReview.length === 0 && rawCount === 0) return null;
    return (
        <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 mb-4">
            <h4 className="text-xs font-bold text-sky-300 uppercase tracking-wider mb-1">🧹 To review ({toReview.length})</h4>
            <p className="text-[11px] text-text-secondary mb-2">
                Saved by older versions without checks (questions, notes, "tomorrow" without a date). I don't use them until you keep them.
            </p>
            <div className="space-y-1.5">
                {toReview.map(fact => (
                    <div key={fact.id} className="flex items-start gap-2 p-2 rounded bg-surface/40">
                        <p className="flex-1 min-w-0 text-sm text-text-primary break-words">{fact.content}</p>
                        <button
                            onClick={() => onSetStatus(fact.id, 'active')}
                            className="text-[11px] px-2 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 flex-shrink-0"
                        >
                            Keep
                        </button>
                        <button onClick={() => onDelete(fact.id)} className="text-gray-500 hover:text-red-500 flex-shrink-0" title="Delete"><TrashIcon /></button>
                    </div>
                ))}
            </div>
            {rawCount > 0 && (
                <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-white/5">
                    <p className="text-[11px] text-text-secondary">{rawCount} raw chat messages in the conversation memory (now conversations are summarized).</p>
                    <button onClick={deleteRaw} className="text-[11px] px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 flex-shrink-0">
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
};
