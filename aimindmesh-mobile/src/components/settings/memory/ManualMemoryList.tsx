import React from 'react';
import { Memory } from '../../../types';
import { TrashIcon } from '../../../constants';

interface ManualMemoryListProps {
    memories: Memory[];
    viewCategory: string;
    memoryCategories: string[];
    onUpdateMemoryCategory: (id: string, newCategory: string) => void;
    onDeleteMemory: (id: string) => void;
}

export const ManualMemoryList: React.FC<ManualMemoryListProps> = ({
    memories,
    viewCategory,
    memoryCategories,
    onUpdateMemoryCategory,
    onDeleteMemory
}) => {
    if (memories.length === 0) return null;

    return (
        <div className="space-y-4">
            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider bg-blue-500/10 p-1 rounded flex items-center gap-1">
                📝 Memorie Manuali ({memories.length})
            </h4>
            {memoryCategories
                .filter(cat => viewCategory === 'all' || viewCategory === cat)
                .map(category => {
                    const categoryMemories = memories.filter(m => (m.category || 'other') === category);
                    if (categoryMemories.length === 0 && viewCategory === 'all') return null;

                    return (
                        <div key={category} className="mb-4">
                            <h5 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2 pl-1">{category}</h5>
                            <div className="space-y-2">
                                {categoryMemories.slice().reverse().map(memory => (
                                    <div key={memory.id} className="flex items-start justify-between p-2 rounded bg-surface/40 hover:bg-surface/80 transition-colors group">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1 mb-1">
                                                <span className="text-[9px] font-bold text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded">Manuale</span>
                                            </div>
                                            <p className="text-sm text-text-secondary break-words">{memory.content}</p>
                                            <div className="flex items-center space-x-2 mt-1">
                                                <span className="text-[10px] text-text-secondary/60">
                                                    {new Date(memory.timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                                                </span>
                                                <select
                                                    value={memory.category || 'other'}
                                                    onChange={(e) => onUpdateMemoryCategory(memory.id, e.target.value)}
                                                    className="bg-transparent text-[10px] text-primary border-none p-0 focus:ring-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    {memoryCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <button onClick={() => onDeleteMemory(memory.id)} className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"><TrashIcon /></button>
                                    </div>
                                ))}
                                {categoryMemories.length === 0 && (
                                    <p className="text-xs text-text-secondary/40 italic pl-2">No memories in this category.</p>
                                )}
                            </div>
                        </div>
                    );
                })}
        </div>
    );
};
