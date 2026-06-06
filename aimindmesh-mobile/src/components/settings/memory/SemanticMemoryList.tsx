import React, { useState, useEffect } from 'react';
import { SemanticMemory } from './types';
import { triggerHaptic } from '../../../services/native';
import { TrashIcon } from '../../../constants';
import { LLMConfig } from '../../../types';

interface SemanticMemoryListProps {
    viewCategory: string;
    memoryCategories: string[];
    llmConfig: LLMConfig;
    apiKey: string;
}

export const SemanticMemoryList: React.FC<SemanticMemoryListProps> = ({
    viewCategory,
    memoryCategories,
    llmConfig,
    apiKey
}) => {
    const [semanticMemories, setSemanticMemories] = useState<SemanticMemory[]>([]);
    const [isLoadingSemanticMemories, setIsLoadingSemanticMemories] = useState(false);
    const [isSummarizing, setIsSummarizing] = useState(false);

    useEffect(() => {
        loadSemanticMemories();
    }, []);

    const loadSemanticMemories = async () => {
        setIsLoadingSemanticMemories(true);
        try {
            const { getAllSemanticMemories } = await import('../../../services/memory/memoryDatabase');
            const memories = await getAllSemanticMemories(100);
            setSemanticMemories(memories);
        } catch (e) {
            console.error('Failed to load semantic memories', e);
        } finally {
            setIsLoadingSemanticMemories(false);
        }
    };

    const handleDeleteSemanticMemory = async (id: string) => {
        try {
            const { deleteMemoryFromDb } = await import('../../../services/memory/memoryDatabase');
            await deleteMemoryFromDb(id);
            setSemanticMemories(prev => prev.filter(m => m.id !== id));
            triggerHaptic();
        } catch (e) {
            console.error('Failed to delete semantic memory', e);
            alert('Error deleting memory');
        }
    };

    const handleUpdateSemanticMemoryCategory = async (id: string, category: string) => {
        try {
            const { updateSemanticMemoryCategory } = await import('../../../services/memory/memoryDatabase');
            await updateSemanticMemoryCategory(id, category);
            setSemanticMemories(prev => prev.map(m => m.id === id ? { ...m, category } : m));
        } catch (e) {
            console.error('Failed to update semantic memory category', e);
        }
    };

    const handleSummarizeMemories = async () => {
        const isLocalProvider = ['native-gguf', 'litert', 'local-model', 'local', 'in-browser-downloaded'].includes(llmConfig.provider);
        if (!apiKey && !isLocalProvider) {
            alert('API Key required for summarization');
            return;
        }
        setIsSummarizing(true);
        triggerHaptic();
        try {
            const { MemorySummarizer } = await import('../../../services/memory/memorySummarizer');
            const summarizer = new MemorySummarizer(llmConfig, apiKey);

            // 1. Consolidate (Semantic Deduplication)
            const threshold = llmConfig.memorySimilarityThreshold || 0.80;
            const consolidationResult = await summarizer.consolidateRedundantMemories(threshold);

            // 2. Summarize Oldest (Compression)
            const summaryResult = await summarizer.summarizeMemories(20);

            let msg = '';
            if (consolidationResult.success && consolidationResult.consolidatedCount > 0) {
                msg += `${consolidationResult.message}\n`;
            }
            if (summaryResult.success) {
                msg += summaryResult.message;
            } else if (!consolidationResult.consolidatedCount) {
                msg = summaryResult.message;
            }

            alert(msg || 'Maintenance completed. No actions needed.');
            loadSemanticMemories(); // Reload
        } catch (e: any) {
            console.error('Summarization failed', e);
            alert('Summarization failed: ' + e.message);
        } finally {
            setIsSummarizing(false);
        }
    };

    return (
        <>
            {/* Summarization Button */}
            {llmConfig.enableSemanticMemory && (
                <div className="mb-3">
                    <button
                        onClick={handleSummarizeMemories}
                        disabled={isSummarizing || semanticMemories.length < 5}
                        className={`w-full py-2 px-3 rounded text-xs font-bold flex items-center justify-center space-x-2 transition-colors ${isSummarizing || semanticMemories.length < 5 ? 'bg-surface/50 text-text-secondary cursor-not-allowed' : 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/50'}`}
                    >
                        {isSummarizing ? (
                            <span>⏳ Summarizing...</span>
                        ) : (
                            <span>✨ Compress & Summarize Memories</span>
                        )}
                    </button>
                    {semanticMemories.length < 5 && (
                        <p className="text-[9px] text-text-secondary/60 text-center mt-1">Need at least 5 memories to summarize</p>
                    )}
                </div>
            )}

            {semanticMemories.length > 0 && (
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider bg-purple-500/10 p-1 rounded flex items-center gap-1">
                            🧠 Semantic Memories ({semanticMemories.length})
                        </h4>
                        <button
                            onClick={loadSemanticMemories}
                            className="text-[10px] text-purple-400 hover:underline"
                        >
                            🔄 Aggiorna
                        </button>
                    </div>
                    {isLoadingSemanticMemories ? (
                        <p className="text-xs text-text-secondary/60 italic">Loading...</p>
                    ) : (
                        <div className="space-y-2">
                            {semanticMemories
                                .filter(m => viewCategory === 'all' || m.category === viewCategory)
                                .map(memory => (
                                    <div key={memory.id} className="flex items-start justify-between p-2 rounded bg-purple-500/5 border border-purple-500/10 hover:bg-purple-500/10 transition-colors group">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1 mb-1">
                                                <span className="text-[9px] font-bold text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">AI</span>
                                                <span className="text-[9px] text-text-secondary/60">{memory.role}</span>
                                            </div>
                                            <p className="text-sm text-text-secondary break-words">{memory.content}</p>
                                            <div className="flex items-center space-x-2 mt-1">
                                                <span className="text-[10px] text-text-secondary/60">
                                                    {new Date(memory.timestamp).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                                                </span>
                                                <select
                                                    value={memory.category}
                                                    onChange={(e) => handleUpdateSemanticMemoryCategory(memory.id, e.target.value)}
                                                    className="bg-transparent text-[10px] text-purple-400 border-none p-0 focus:ring-0 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    {[...memoryCategories, 'semantic'].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteSemanticMemory(memory.id)}
                                            className="text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            )}
            {semanticMemories.length === 0 && (
                <p className="text-xs text-text-secondary italic text-center mt-10">No semantic memories yet.</p>
            )}
        </>
    );
};
