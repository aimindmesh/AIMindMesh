import React, { useState } from 'react';
import { DownloadIcon } from '../../../constants';
import { MemorySettingsProps } from './types';
import { EmbeddingModelSection } from './EmbeddingModelSection';
import { SemanticMemoryList } from './SemanticMemoryList';
import { AddMemorySection } from './AddMemorySection';
import { CategoryManager } from './CategoryManager';
import { FactList } from './FactList';
import { OpenLoopsList } from './OpenLoopsList';
import { ReviewList } from './ReviewList';

/**
 * Settings → Memory: what the assistant knows about the user (facts it learned or was told,
 * open loops), the conversation memory (semantic search over past chats) and backups.
 */
const MemorySettings: React.FC<MemorySettingsProps> = ({ memory, onClearAll, llmConfig, onLlmConfigSave }) => {
    const [viewCategory, setViewCategory] = useState<string>('all');
    const activeCount = memory.facts.filter(f => f.status === 'active').length;

    return (
        <div className="flex flex-col h-full p-6 overflow-y-auto animate-fade-in">
            {/* Backup & AI Settings */}
            <div className="flex flex-col space-y-3 p-3 bg-surface/30 rounded-lg mb-4">
                <div className="flex justify-between items-center gap-3">
                    <div>
                        <span className="text-sm font-medium">AI Auto-Categorization</span>
                        <p className="text-[10px] text-text-secondary">What I learn in the chat is filed under your labels</p>
                    </div>
                    <button
                        onClick={() => memory.setEnableAiMemoryCategorization(!memory.enableAiMemoryCategorization)}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${memory.enableAiMemoryCategorization ? 'bg-primary text-white' : 'bg-surface textSecondary'}`}
                    >
                        {memory.enableAiMemoryCategorization ? 'ON' : 'OFF'}
                    </button>
                </div>
                <div className="flex space-x-2">
                    <button onClick={memory.exportMemories} className="flex-1 py-2 bg-surface hover:bg-surface/80 rounded text-xs flex items-center justify-center space-x-1">
                        <DownloadIcon /> <span>Backup</span>
                    </button>
                    <button onClick={memory.importMemories} className="flex-1 py-2 bg-surface hover:bg-surface/80 rounded text-xs flex items-center justify-center space-x-1">
                        <span>Restore</span>
                    </button>
                </div>
            </div>

            <OpenLoopsList facts={memory.facts} onSetStatus={memory.setFactStatus} onDelete={memory.deleteFact} />
            <ReviewList facts={memory.facts} onSetStatus={memory.setFactStatus} onDelete={memory.deleteFact} semanticMemory={!!llmConfig.enableSemanticMemory} />

            {/* What the assistant knows about the user */}
            <div className="p-3 rounded-lg bg-surface/20 border border-white/5 mb-4">
                <h3 className="text-sm font-semibold text-text-primary mb-1">🧠 What I know about you ({activeCount})</h3>
                <p className="text-[11px] text-text-secondary mb-3">
                    Learned while we talk (after a few quiet minutes) or told by you here. Tap a text to correct it; 📌 keeps it always in mind.
                </p>
                <CategoryManager
                    memoryCategories={memory.memoryCategories}
                    onAddMemoryCategory={memory.addMemoryCategory}
                    onDeleteMemoryCategory={memory.deleteMemoryCategory}
                    viewCategory={viewCategory}
                    setViewCategory={setViewCategory}
                />
                <FactList
                    facts={memory.facts}
                    categories={memory.memoryCategories}
                    viewCategory={viewCategory}
                    onUpdate={memory.updateFact}
                    onDelete={memory.deleteFact}
                />
            </div>

            <AddMemorySection onAddFact={memory.addFact} memoryCategories={memory.memoryCategories} />

            {/* Conversation memory: semantic search over past chats */}
            <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg mb-4 border border-purple-500/20">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">💬</span>
                        <span className="text-sm font-medium textPrimary">Conversation Memory</span>
                    </div>
                    <button
                        onClick={() => onLlmConfigSave({ ...llmConfig, enableSemanticMemory: !llmConfig.enableSemanticMemory })}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${llmConfig.enableSemanticMemory ? 'bg-purple-500 text-white' : 'bg-surface textSecondary'}`}
                    >
                        {llmConfig.enableSemanticMemory ? 'ON' : 'OFF'}
                    </button>
                </div>
                <p className="text-xs textSecondary mb-3">
                    Finds what you said in past conversations by meaning, and matches facts by meaning instead of words. Needs an embedding model (multilingual recommended).
                </p>

                {llmConfig.enableSemanticMemory && (
                    <>
                        <SemanticMemoryList viewCategory={viewCategory} memoryCategories={memory.memoryCategories} llmConfig={llmConfig} />
                        <EmbeddingModelSection llmConfig={llmConfig} onLlmConfigSave={onLlmConfigSave} />
                    </>
                )}
            </div>

            <div className="mt-4 pt-2 border-t border-white/5">
                <button onClick={onClearAll} className="text-xs text-red-400 hover:text-red-300 w-full text-center p-2 hover:bg-red-500/10 rounded transition-colors">
                    Delete All Memories
                </button>
            </div>
        </div>
    );
};

export default MemorySettings;
