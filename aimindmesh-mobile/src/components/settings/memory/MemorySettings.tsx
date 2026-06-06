import React, { useState } from 'react';
import { DownloadIcon } from '../../../constants';
import { MemorySettingsProps } from './types';
import { EmbeddingModelSection } from './EmbeddingModelSection';
import { SemanticMemoryList } from './SemanticMemoryList';
import { ManualMemoryList } from './ManualMemoryList';
import { AddMemorySection } from './AddMemorySection';
import { CategoryManager } from './CategoryManager';

const MemorySettings: React.FC<MemorySettingsProps> = ({
    memories,
    onAddMemory,
    onDeleteMemory,
    onClearMemories,
    memoryCategories,
    onAddMemoryCategory,
    onDeleteMemoryCategory,
    onUpdateMemoryCategory,
    onExportMemories,
    onImportMemories,
    enableAiMemoryCategorization,
    onEnableAiMemoryCategorizationChange,
    llmConfig,
    onLlmConfigSave,
    apiKey
}) => {
    const [viewCategory, setViewCategory] = useState<string>('all');

    return (
        <div className="flex flex-col h-full p-6 overflow-y-auto animate-fade-in">
            {/* Backup & AI Settings */}
            <div className="flex flex-col space-y-3 p-3 bg-surface/30 rounded-lg mb-4">
                <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">AI Auto-Categorization</span>
                    <button
                        onClick={() => onEnableAiMemoryCategorizationChange(!enableAiMemoryCategorization)}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${enableAiMemoryCategorization ? 'bg-primary text-white' : 'bg-surface textSecondary'}`}
                    >
                        {enableAiMemoryCategorization ? 'ON' : 'OFF'}
                    </button>
                </div>
                <div className="flex space-x-2">
                    <button onClick={onExportMemories} className="flex-1 py-2 bg-surface hover:bg-surface/80 rounded text-xs flex items-center justify-center space-x-1">
                        <DownloadIcon /> <span>Backup</span>
                    </button>
                    <button onClick={onImportMemories} className="flex-1 py-2 bg-surface hover:bg-surface/80 rounded text-xs flex items-center justify-center space-x-1">
                        <span>Restore</span>
                    </button>
                </div>
            </div>

            {/* Semantic Memory Section */}
            <div className="p-3 bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-lg mb-4 border border-purple-500/20">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">🧠</span>
                        <span className="text-sm font-medium textPrimary">Semantic Memory</span>
                    </div>
                    <button
                        onClick={() => onLlmConfigSave({ ...llmConfig, enableSemanticMemory: !llmConfig.enableSemanticMemory })}
                        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${llmConfig.enableSemanticMemory ? 'bg-purple-500 text-white' : 'bg-surface textSecondary'}`}
                    >
                        {llmConfig.enableSemanticMemory ? 'ON' : 'OFF'}
                    </button>
                </div>
                <p className="text-xs textSecondary mb-3">
                    Automatically retrieves relevant memories from semantic context to enrich AI responses.
                </p>

                {llmConfig.enableSemanticMemory && (
                    <>
                        <SemanticMemoryList
                            viewCategory={viewCategory}
                            memoryCategories={memoryCategories}
                            llmConfig={llmConfig}
                            apiKey={apiKey}
                        />

                        <div className="mt-4 mb-2">
                            <label className="block text-xs font-medium textSecondary mb-1">
                                Consolidation Similarity Threshold ({llmConfig.memorySimilarityThreshold || 0.80})
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="1.0"
                                step="0.01"
                                value={llmConfig.memorySimilarityThreshold || 0.80}
                                onChange={(e) => onLlmConfigSave({
                                    ...llmConfig,
                                    memorySimilarityThreshold: parseFloat(e.target.value)
                                })}
                                className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                            />
                            <p className="text-[10px] text-text-secondary/60 mt-1">
                                Threshold for merging similar memories (Higher = stricter, Lower = more grouping)
                            </p>
                        </div>

                        <EmbeddingModelSection
                            llmConfig={llmConfig}
                            onLlmConfigSave={onLlmConfigSave}
                        />
                    </>
                )}
            </div>

            {/* Add Memory */}
            <AddMemorySection
                onAddMemory={onAddMemory}
                memoryCategories={memoryCategories}
            />

            {/* Category Management */}
            <CategoryManager
                memoryCategories={memoryCategories}
                onAddMemoryCategory={onAddMemoryCategory}
                onDeleteMemoryCategory={onDeleteMemoryCategory}
                viewCategory={viewCategory}
                setViewCategory={setViewCategory}
            />

            {/* Memory List */}
            <div className="flex-1 overflow-y-auto bg-surface/50 p-2 rounded-md min-h-0 mb-4">
                <ManualMemoryList
                    memories={memories}
                    viewCategory={viewCategory}
                    memoryCategories={memoryCategories}
                    onUpdateMemoryCategory={onUpdateMemoryCategory}
                    onDeleteMemory={onDeleteMemory}
                />
            </div>

            <div className="mt-4 pt-2 border-t border-white/5">
                <button onClick={onClearMemories} className="text-xs text-red-400 hover:text-red-300 w-full text-center p-2 hover:bg-red-500/10 rounded transition-colors">
                    Delete All Memories
                </button>
            </div>
        </div>
    );
};

export default MemorySettings;
