import React from 'react';
import { LLMConfig } from '../../../types';
import { AUTO_CONTEXT_DEFAULT, contextLabel, onDeviceContextSize } from '../../../services/llm/context/contextSize';

interface ContextWindowSettingProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    /** Extra notes under the slider (e.g. the OpenCL cap of the GGUF engine) */
    children?: React.ReactNode;
}

/**
 * Context window of the on-device engines: automatic for the phone (8192 on the 8 Elite, 4096
 * otherwise; QAIRT bundles keep their own) or set by hand. Moving the slider switches to manual.
 */
const ContextWindowSetting: React.FC<ContextWindowSettingProps> = ({ llmConfig, onLlmConfigSave, children }) => {
    const auto = llmConfig.contextMode !== 'manual';
    const value = onDeviceContextSize(llmConfig);
    const setManual = (size: number) => onLlmConfigSave({ ...llmConfig, contextMode: 'manual', nCtx: size, contextSize: size });

    return (
        <div className="pt-2 border-t border-white/5 space-y-2">
            <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-textPrimary">📐 Context Window</label>
                <span className="text-sm font-bold text-primary">{contextLabel(llmConfig)}</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-textSecondary cursor-pointer">
                <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => e.target.checked
                        ? onLlmConfigSave({ ...llmConfig, contextMode: 'auto' })
                        : setManual(value || AUTO_CONTEXT_DEFAULT)}
                    className="accent-primary"
                />
                Automatic for this phone (8192 on Snapdragon 8 Elite, 4096 otherwise)
            </label>
            <input
                type="range"
                min="1024"
                max="32768"
                step="1024"
                value={value}
                disabled={auto}
                onChange={(e) => setManual(parseInt(e.target.value))}
                className={`w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary ${auto ? 'opacity-40' : ''}`}
            />
            <div className="flex justify-between text-[10px] text-textSecondary">
                <span>1k</span>
                <span>32k</span>
            </div>
            <p className="text-[10px] text-textSecondary/60">
                More context keeps longer conversations, but the whole prompt is read again after a reset
                (about 7 s for 6k tokens on the NPU). AI Hub bundles use the context they were built with.
            </p>
            {children}
        </div>
    );
};

export default ContextWindowSetting;
