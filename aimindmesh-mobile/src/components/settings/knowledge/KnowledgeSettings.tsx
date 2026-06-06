import { DocumentManager } from '../../documents/DocumentManager';
import { WorkspaceSelector } from '../../workspaces/WorkspaceSelector';
import { LLMConfig } from '../../../types';
import { EmbeddingModelSection } from '../memory/EmbeddingModelSection';

interface KnowledgeSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    disablePing: boolean;
    onDisablePingChange: (disabled: boolean) => void;
}

export const KnowledgeSettings: React.FC<KnowledgeSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    disablePing,
    onDisablePingChange
}) => {
    return (
        <div className="space-y-6">
            <div className="bg-surface p-4 rounded-xl border border-white/5">
                <h3 className="text-lg font-medium text-textPrimary mb-2">Workspaces</h3>
                <p className="text-sm text-textSecondary mb-4">
                    Organize your documents into workspaces. Select a workspace to manage its documents.
                </p>
                <div className="max-w-md">
                    <WorkspaceSelector />
                </div>
            </div>

            <div className="bg-surface p-4 rounded-xl border border-white/5">
                <h3 className="text-lg font-medium text-textPrimary mb-4">Document Management</h3>
                <DocumentManager llmConfig={llmConfig} />
            </div>

            <div className="bg-surface p-4 rounded-xl border border-white/5">
                <h3 className="text-lg font-medium text-textPrimary mb-2">RAG Configuration</h3>
                <p className="text-sm text-textSecondary mb-4">
                    Configure document processing and retrieval settings.
                </p>

                <div className="space-y-4">
                    <EmbeddingModelSection llmConfig={llmConfig} onLlmConfigSave={onLlmConfigSave} />

                    {/* Chunking Strategy */}
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1">Chunking Strategy</label>
                        <select
                            value={llmConfig.ragChunkingStrategy || 'recursive'}
                            onChange={(e) => onLlmConfigSave({ ...llmConfig, ragChunkingStrategy: e.target.value as any })}
                            className="w-full bg-input border-surface rounded-md px-3 py-2 text-textPrimary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="recursive">Recursive (Recommended)</option>
                            <option value="page-level">Page Level (PDFs)</option>
                        </select>
                    </div>

                    {/* Chunk Size */}
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1 flex justify-between">
                            <span>Chunk Size (chars)</span>
                            <span className="text-primary">{llmConfig.ragChunkSize || 2000}</span>
                        </label>
                        <input
                            type="range"
                            min="512"
                            max="4096"
                            step="128"
                            value={llmConfig.ragChunkSize || 2000}
                            onChange={(e) => onLlmConfigSave({ ...llmConfig, ragChunkSize: parseInt(e.target.value) })}
                            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>

                    {/* Chunk Overlap */}
                    <div>
                        <label className="block text-xs font-medium text-text-secondary mb-1 flex justify-between">
                            <span>Chunk Overlap (chars)</span>
                            <span className="text-primary">{llmConfig.ragChunkOverlap || 200}</span>
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="500"
                            step="50"
                            value={llmConfig.ragChunkOverlap || 200}
                            onChange={(e) => onLlmConfigSave({ ...llmConfig, ragChunkOverlap: parseInt(e.target.value) })}
                            className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>
                </div>

                <div className="mt-4 p-3 bg-blue-500/10 text-blue-400 rounded-lg text-sm">
                    🚀 Hybrid Search (Keyword + Vector) is active.
                </div>
            </div>

            {/* Connectivity Check Toggle */}
            <div className="bg-surface p-4 rounded-xl border border-white/5 flex items-center justify-between">
                <div>
                    <div className="font-medium text-textPrimary">Disable Connectivity Check</div>
                    <div className="text-sm text-textSecondary">
                        Disables frequent database pings to save battery.
                        <span className="block text-xs text-yellow-400 mt-1">
                            Enable if you experience connection issues.
                        </span>
                    </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={disablePing}
                        onChange={(e) => onDisablePingChange(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
            </div>
        </div>
    );
};
