import React, { useState } from 'react';
import { WakeWordModelInfo } from '../../../services/wakeword';
import { getCleanModelName } from '../../../utils/stringUtils';

interface WakeWordModelListProps {
    modelName: string;
    onModelChange: (modelName: string) => void;
    availableModels: WakeWordModelInfo[];
    isPluginAvailable: boolean;
    hasRequiredBaseModels: boolean;
    setIsWizardOpen: (isOpen: boolean) => void;
    onDeleteModel: (modelToDelete: string, displayName: string) => void;
}

export const WakeWordModelList: React.FC<WakeWordModelListProps> = ({
    modelName,
    onModelChange,
    availableModels,
    isPluginAvailable,
    hasRequiredBaseModels,
    setIsWizardOpen,
    onDeleteModel
}) => {
    const [isManageModelsOpen, setIsManageModelsOpen] = useState(false);
    const selectedModelInfo = availableModels.find(m => m.name === modelName);
    const isModelDownloaded = selectedModelInfo?.isDownloaded ?? false;

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <label className="text-white text-sm">Wake Word Model</label>
                <select
                    value={modelName}
                    onChange={(e) => onModelChange(e.target.value)}
                    className="w-full bg-surface border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary"
                >
                    {availableModels.length === 0 && <option value="">No models found</option>}
                    {availableModels.map((model) => (
                        <option key={model.name} value={model.name}>
                            {getCleanModelName(model.displayName)} {model.isDownloaded ? '✓' : '(not downloaded)'}
                        </option>
                    ))}
                </select>

                {selectedModelInfo && (
                    <div className="flex flex-col gap-2 mt-2">
                        <p className="text-xs text-gray-400">
                            {selectedModelInfo.description}
                            {selectedModelInfo.fileSize && (
                                <span className="ml-2">
                                    ({(selectedModelInfo.fileSize / 1024).toFixed(1)} KB)
                                </span>
                            )}
                        </p>

                        {selectedModelInfo.isDownloaded && (
                            <button
                                onClick={() => onDeleteModel(modelName, getCleanModelName(selectedModelInfo.displayName))}
                                className="self-start px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded text-xs text-red-200 transition-colors flex items-center gap-2"
                            >
                                <span>🗑️</span> Delete Selected Model
                            </button>
                        )}
                    </div>
                )}

                {!isModelDownloaded && modelName && (
                    <p className="text-xs text-yellow-400">
                        ⚠️ This model is not downloaded. Please download it from the OpenWakeWord repository.
                    </p>
                )}
            </div>

            {isPluginAvailable && hasRequiredBaseModels && (
                <button
                    onClick={() => setIsWizardOpen(true)}
                    className="w-full py-3 px-3 mt-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-medium rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all"
                >
                    <span>🪄</span> Train Custom Wake Word
                </button>
            )}

            {/* Manage Models Section */}
            {availableModels.some(m => m.isDownloaded) && (
                <div className="border border-gray-700 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setIsManageModelsOpen(!isManageModelsOpen)}
                        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 text-sm text-white transition-colors"
                    >
                        <span>Manage Installed Models ({availableModels.filter(m => m.isDownloaded).length})</span>
                        <span className={`transform transition-transform ${isManageModelsOpen ? 'rotate-180' : ''}`}>▼</span>
                    </button>

                    {isManageModelsOpen && (
                        <div className="bg-gray-900/50 divide-y divide-gray-700 max-h-60 overflow-y-auto">
                            {availableModels.filter(m => m.isDownloaded).map(model => (
                                <div key={model.name} className="p-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                                    <div className="flex flex-col">
                                        <span className="text-sm text-white font-medium">{getCleanModelName(model.displayName)}</span>
                                        <span className="text-xs text-gray-400">{model.name}</span>
                                    </div>
                                    <button
                                        onClick={() => onDeleteModel(model.name, getCleanModelName(model.displayName))}
                                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full transition-colors"
                                        title="Delete model"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
