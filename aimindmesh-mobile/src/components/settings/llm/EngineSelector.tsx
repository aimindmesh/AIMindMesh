import React from 'react';
import { LLMConfig } from '../../../types';

interface EngineSelectorProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    triggerHaptic: () => void;
}

const EngineSelector: React.FC<EngineSelectorProps> = ({
    llmConfig,
    onLlmConfigSave,
    triggerHaptic
}) => {
    return (
        <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
                🔧 LLM Engine
            </label>
            <div className="grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, engine: 'gguf' }); }}
                    className={`py-3 px-4 rounded-lg border transition-all flex flex-col items-center gap-1
            ${(llmConfig.engine || 'gguf') === 'gguf'
                            ? 'bg-green-500/20 border-green-400 text-green-300'
                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                >
                    <span className="text-xl">🦙</span>
                    <span className="text-sm font-medium">GGUF</span>
                    <span className="text-[10px] opacity-70">llama.cpp</span>
                </button>
                <button
                    type="button"
                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, engine: 'litert' }); }}
                    className={`py-3 px-4 rounded-lg border transition-all flex flex-col items-center gap-1
            ${llmConfig.engine === 'litert'
                            ? 'bg-blue-500/20 border-blue-400 text-blue-300'
                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                >
                    <span className="text-xl">🏷️</span>
                    <span className="text-sm font-medium">LiteRT</span>
                    <span className="text-[10px] opacity-70">Gemma 3n</span>
                </button>
            </div>
            <p className="text-xs text-text-tertiary mt-2">
                {(llmConfig.engine || 'gguf') === 'gguf'
                    ? 'llama.cpp: Runs GGUF models locally.'
                    : 'LiteRT: Google AI Edge with Gemma models. Native multimodal support.'}
            </p>

            {/* Persistence Toggle */}
            <div className="mt-4 flex items-center justify-between p-3 bg-surface/30 rounded-lg border border-white/5">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">Always Keep Loaded</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            RAM HEAVY
                        </span>
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                        Keeps model in RAM even when app is backgrounded. prevents reloading delay but consumes more battery.
                    </p>
                </div>
                <button
                    onClick={() => {
                        triggerHaptic();
                        onLlmConfigSave({ ...llmConfig, alwaysKeepLoaded: !llmConfig.alwaysKeepLoaded });
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-background ${llmConfig.alwaysKeepLoaded ? 'bg-green-500' : 'bg-surface-variant'
                        }`}
                >
                    <span
                        className={`${llmConfig.alwaysKeepLoaded ? 'translate-x-6' : 'translate-x-1'
                            } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                    />
                </button>
            </div>
        </div>
    );
};

export default EngineSelector;
