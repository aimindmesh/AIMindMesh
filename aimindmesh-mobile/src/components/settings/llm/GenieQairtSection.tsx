import React from 'react';
import type { GenieModelInfo } from 'genie-capacitor';
import GenieModelRow from './GenieModelRow';

interface GenieQairtSectionProps {
    supported: boolean;
    models: GenieModelInfo[];
    currentPath?: string;
    busy: boolean;
    isImporting: boolean;
    onImport: () => void;
    onLoad: (model: GenieModelInfo) => void;
}

/** Qualcomm AI Hub bundles (QAIRT): compiled for one NPU generation, GenieX 0.3.5 runs them on 8 Elite only */
const GenieQairtSection: React.FC<GenieQairtSectionProps> = ({ supported, models, currentPath, busy, isImporting, onImport, onLoad }) => (
    <div className="border-t border-white/5 pt-2">
        <div className="flex items-center justify-between mb-3">
            <h5 className="text-sm font-semibold text-text-primary">Qualcomm AI Hub bundles</h5>
            {supported && (
                <button
                    onClick={onImport}
                    disabled={isImporting}
                    className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/30 flex items-center gap-1.5 transition-colors"
                >
                    {isImporting ? (
                        <>
                            <div className="w-3 h-3 border-2 border-amber-300 border-t-transparent rounded-full animate-spin"></div>
                            <span>Extracting...</span>
                        </>
                    ) : (
                        <>
                            <span>📦</span>
                            <span>Import Model (.zip)</span>
                        </>
                    )}
                </button>
            )}
        </div>

        {!supported ? (
            <p className="text-[11px] text-text-tertiary">
                AI Hub bundles are compiled for one NPU generation and GenieX ships their runtime for Snapdragon 8 Elite only.
                On this phone use the GGUF models above: they run on the same NPU.
            </p>
        ) : models.length > 0 ? (
            <div className="space-y-2">
                {models.map(model => (
                    <GenieModelRow
                        key={model.path}
                        model={model}
                        isCurrent={currentPath === model.path}
                        disabled={busy}
                        onLoad={() => onLoad(model)}
                    />
                ))}
            </div>
        ) : (
            <div className="p-4 bg-surface/30 rounded-xl border border-white/5 text-center">
                <p className="text-xs text-text-secondary">No AI Hub bundles imported yet.</p>
                <p className="text-[11px] text-text-tertiary mt-1">
                    Export a model for Snapdragon 8 Elite from Qualcomm AI Hub (e.g. Gemma-4-E4B-it, Qwen3-4B-Instruct-2507) and tap <strong>Import Model (.zip)</strong>.
                </p>
            </div>
        )}
    </div>
);

export default GenieQairtSection;
