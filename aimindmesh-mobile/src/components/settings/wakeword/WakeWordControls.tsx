import React from 'react';
import { THRESHOLD_PRESETS } from '../../../services/wakeword';

interface WakeWordControlsProps {
    threshold: number;
    onThresholdChange: (value: number) => void;
    cooldownMs: number;
    onCooldownChange: (value: number) => void;
    bufferSize: number;
    onBufferSizeChange: (value: number) => void;
    consecutiveFrames: number;
    onConsecutiveFramesChange?: (value: number) => void;
    modelName: string;
}

export const WakeWordControls: React.FC<WakeWordControlsProps> = ({
    threshold,
    onThresholdChange,
    cooldownMs,
    onCooldownChange,
    bufferSize,
    onBufferSizeChange,
    consecutiveFrames,
    onConsecutiveFramesChange,
    modelName,
}) => {
    // Get threshold preset name
    const getThresholdPresetName = (value: number): string => {
        if (value <= 0.35) return 'High Sensitivity';
        if (value <= 0.5) return 'Balanced';
        if (value <= 0.65) return 'Low Sensitivity';
        return 'Strict';
    };

    // Get buffer size description
    const getBufferSizeDescription = (value: number): string => {
        if (value <= 12) return 'More reactive';
        if (value <= 20) return 'Balanced';
        return 'More stable';
    };

    return (
        <>
            {/* Threshold Slider */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-white text-sm">Detection Threshold</label>
                    <span className="text-xs text-gray-400">
                        {threshold.toFixed(2)} ({getThresholdPresetName(threshold)})
                    </span>
                </div>
                <input
                    type="range"
                    min="0.2"
                    max="0.8"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>More sensitive</span>
                    <span>Fewer false positives</span>
                </div>
            </div>

            {/* Cooldown Slider */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-white text-sm">Cooldown Period</label>
                    <span className="text-xs text-gray-400">
                        {(cooldownMs / 1000).toFixed(1)}s
                    </span>
                </div>
                <input
                    type="range"
                    min="500"
                    max="5000"
                    step="250"
                    value={cooldownMs}
                    onChange={(e) => onCooldownChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <p className="text-xs text-gray-500">
                    Time to wait before detecting again (prevents repeated triggers)
                </p>
            </div>

            {/* Consecutive Frames Slider (Custom Models Only) */}
            {modelName.startsWith('custom:') && onConsecutiveFramesChange && (
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-white text-sm">Temporal Consistency</label>
                        <span className="text-xs text-gray-400">
                            {consecutiveFrames} frames (~{consecutiveFrames * 80}ms)
                        </span>
                    </div>
                    <input
                        type="range"
                        min="3"
                        max="15"
                        step="1"
                        value={consecutiveFrames}
                        onChange={(e) => onConsecutiveFramesChange(parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <p className="text-xs text-gray-500">
                        Requires consistent detection for N frames. Higher = fewer false positives but slower.
                    </p>
                </div>
            )}

            {/* Buffer Size Slider */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-white text-sm">Buffer Size</label>
                    <span className="text-xs text-gray-400">
                        {bufferSize} chunks ({getBufferSizeDescription(bufferSize)})
                    </span>
                </div>
                <input
                    type="range"
                    min="8"
                    max="32"
                    step="2"
                    value={bufferSize}
                    onChange={(e) => onBufferSizeChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <div className="flex justify-between text-xs text-gray-500">
                    <span>More reactive</span>
                    <span>More stable</span>
                </div>
            </div>

            {/* Preset Buttons */}
            <div className="space-y-2">
                <label className="text-white text-sm">Quick Presets</label>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => {
                            onThresholdChange(THRESHOLD_PRESETS.HIGH_SENSITIVITY);
                            onBufferSizeChange(12);
                            onCooldownChange(1500);
                        }}
                        className="px-3 py-2 bg-surface border border-gray-600 rounded-lg text-xs text-gray-300 hover:border-primary hover:text-white transition-colors"
                    >
                        🎯 High Sensitivity
                    </button>
                    <button
                        onClick={() => {
                            onThresholdChange(THRESHOLD_PRESETS.BALANCED);
                            onBufferSizeChange(20);
                            onCooldownChange(2000);
                        }}
                        className="px-3 py-2 bg-surface border border-gray-600 rounded-lg text-xs text-gray-300 hover:border-primary hover:text-white transition-colors"
                    >
                        ⚖️ Balanced
                    </button>
                    <button
                        onClick={() => {
                            onThresholdChange(THRESHOLD_PRESETS.LOW_SENSITIVITY);
                            onBufferSizeChange(24);
                            onCooldownChange(2500);
                        }}
                        className="px-3 py-2 bg-surface border border-gray-600 rounded-lg text-xs text-gray-300 hover:border-primary hover:text-white transition-colors"
                    >
                        🔇 Low Sensitivity
                    </button>
                    <button
                        onClick={() => {
                            onThresholdChange(THRESHOLD_PRESETS.STRICT);
                            onBufferSizeChange(28);
                            onCooldownChange(3000);
                        }}
                        className="px-3 py-2 bg-surface border border-gray-600 rounded-lg text-xs text-gray-300 hover:border-primary hover:text-white transition-colors"
                    >
                        🔒 Strict
                    </button>
                </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <p className="text-blue-200 text-xs">
                    <strong>Tip:</strong> Start with "Balanced" settings and adjust based on your environment.
                    If you get too many false activations, increase the threshold.
                    If the wake word is often missed, decrease the threshold.
                </p>
            </div>
        </>
    );
};
