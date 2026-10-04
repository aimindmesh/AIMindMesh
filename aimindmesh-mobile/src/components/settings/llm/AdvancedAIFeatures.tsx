import React from 'react';
import { LLMConfig, AIMindMeshServerSettings } from '../../../types';
import ContextWindowSetting from './ContextWindowSetting';

interface AdvancedAIFeaturesProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    serverSettings?: AIMindMeshServerSettings;
}

const AdvancedAIFeatures: React.FC<AdvancedAIFeaturesProps> = ({ llmConfig, onLlmConfigSave, serverSettings }) => {
    return (
        <div className="space-y-4 bg-purple-500/5 p-4 rounded-lg border border-purple-500/20 mt-4">
            <h4 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">🧠 Advanced AI Features</h4>

            {/* Enable Thinking Toggle */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-textPrimary">Enable Thinking</p>
                    <p className="text-xs text-textSecondary">Shows the model's reasoning in the chat.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={llmConfig.enableThinking || false}
                        onChange={(e) => onLlmConfigSave({ ...llmConfig, enableThinking: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                </label>
            </div>

            {/* Thinking Budget Slider */}
            {llmConfig.enableThinking && (
                <div className="pl-4 border-l-2 border-purple-500/30 space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-sm text-text-secondary">Thinking Token Budget</label>
                        <span className="text-sm font-medium text-purple-400">
                            {llmConfig.thinkingBudget === 0 ? 'Auto' : (llmConfig.thinkingBudget || 8192)}
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="24576"
                        step="1024"
                        value={llmConfig.thinkingBudget || 0}
                        onChange={(e) => onLlmConfigSave({ ...llmConfig, thinkingBudget: parseInt(e.target.value) })}
                        className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-xs text-textSecondary/60">0 = automatic, higher value = deeper reasoning</p>
                </div>
            )}

            {/* Language of the answers */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-textPrimary">Assistant language</p>
                    <p className="text-xs text-textSecondary">Auto follows the language you write in.</p>
                </div>
                <select
                    value={llmConfig.assistantLanguage || 'auto'}
                    onChange={(e) => onLlmConfigSave({ ...llmConfig, assistantLanguage: e.target.value as LLMConfig['assistantLanguage'] })}
                    className="bg-input text-textPrimary text-sm rounded-lg border border-white/10 px-2 py-1"
                >
                    <option value="auto">Auto</option>
                    <option value="it">Italiano</option>
                    <option value="en">English</option>
                </select>
            </div>

            {/* Context window of the on-device engines */}
            {(llmConfig.provider === 'litert' || llmConfig.provider === 'native-gguf' || llmConfig.provider === 'genie-npu') && (
                <ContextWindowSetting llmConfig={llmConfig} onLlmConfigSave={onLlmConfigSave} />
            )}

            {/* Enable Search Toggle - Gemini, Perplexity or Server integration */}
            {(llmConfig.provider === 'gemini' || 
              llmConfig.provider === 'perplexity' || 
              (serverSettings?.enabled && (serverSettings?.useAsDefaultProvider || llmConfig.serverSideAgenticEnabled))) && (
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-textPrimary">🔍 Internet Search</p>
                        <p className="text-xs text-textSecondary">Allow the model to search for information online.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={llmConfig.enableSearch || false}
                            onChange={(e) => onLlmConfigSave({ ...llmConfig, enableSearch: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                    </label>
                </div>
            )}
        </div>
    );
};

export default AdvancedAIFeatures;
