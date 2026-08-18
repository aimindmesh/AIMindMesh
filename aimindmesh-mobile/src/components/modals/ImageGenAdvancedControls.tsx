import React from 'react';

interface ImageGenAdvancedControlsProps {
    showAdvanced: boolean;
    setShowAdvanced: (show: boolean) => void;
    negativePrompt: string;
    setNegativePrompt: (val: string) => void;
    steps: number;
    setSteps: (val: number) => void;
    cfgScale: number;
    setCfgScale: (val: number) => void;
}

export const ImageGenAdvancedControls: React.FC<ImageGenAdvancedControlsProps> = ({
    showAdvanced,
    setShowAdvanced,
    negativePrompt,
    setNegativePrompt,
    steps,
    setSteps,
    cfgScale,
    setCfgScale
}) => {
    return (
        <div>
            <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 transition-colors"
            >
                <span>{showAdvanced ? '▼' : '▶'}</span>
                <span>Advanced Controls (Steps, CFG Scale, Negative Prompt)</span>
            </button>

            {showAdvanced && (
                <div className="mt-3 space-y-3 p-3 bg-surface/30 rounded-xl border border-white/5 text-xs">
                    <div className="space-y-1">
                        <label className="text-text-secondary">Negative Prompt:</label>
                        <input
                            type="text"
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            className="w-full bg-input text-text-primary rounded-lg p-2 text-xs border border-white/10"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-text-secondary block mb-1">Steps: {steps}</label>
                            <input
                                type="range"
                                min="5"
                                max="50"
                                step="1"
                                value={steps}
                                onChange={(e) => setSteps(parseInt(e.target.value))}
                                className="w-full accent-amber-400"
                            />
                        </div>
                        <div>
                            <label className="text-text-secondary block mb-1">
                                CFG: {cfgScale} {cfgScale >= 6.5 && cfgScale <= 9.0 ? '✨ (Optimal)' : cfgScale > 15 ? '🔥 (High)' : ''}
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="25"
                                step="0.5"
                                value={cfgScale}
                                onChange={(e) => setCfgScale(parseFloat(e.target.value))}
                                className="w-full accent-amber-400"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
