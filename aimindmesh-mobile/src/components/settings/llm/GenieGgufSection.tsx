import React from 'react';
import type { GenieModelInfo, GenieRuntime } from 'genie-capacitor';
import { RECOMMENDED_GENIE_MODELS, ModelDownloadProgress, formatFileSize } from '../../../services/model/modelDownloader';
import { GenieRecommendedModel, recommendedFileName } from '../../../hooks/useGenieModels';
import GenieModelRow from './GenieModelRow';

const UNITS: Array<{ value: GenieRuntime; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'npu', label: 'NPU' },
    { value: 'gpu', label: 'GPU' },
    { value: 'cpu', label: 'CPU' },
];

interface GenieGgufSectionProps {
    models: GenieModelInfo[];
    currentPath?: string;
    runtime: GenieRuntime;
    busy: boolean;
    progress: Record<string, ModelDownloadProgress>;
    onRuntimeChange: (runtime: GenieRuntime) => void;
    onLoad: (model: GenieModelInfo) => void;
    onDelete: (model: GenieModelInfo) => void;
    onDownload: (model: GenieRecommendedModel) => void;
    onCancel: (model: GenieRecommendedModel) => void;
}

/** GGUF files on GenieX's llama_cpp runtime: the same file on the NPU of every Snapdragon 8 Gen 2+ */
const GenieGgufSection: React.FC<GenieGgufSectionProps> = ({
    models, currentPath, runtime, busy, progress, onRuntimeChange, onLoad, onDelete, onDownload, onCancel,
}) => {
    const onDisk = new Set(models.map(m => m.path.split('/').pop()));
    const toDownload = RECOMMENDED_GENIE_MODELS.filter(m => !onDisk.has(recommendedFileName(m)));

    return (
        <div className="border-t border-white/5 pt-2 space-y-3">
            <div>
                <h5 className="text-sm font-semibold text-text-primary">GGUF models on the NPU</h5>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                    Q4_0, Q4_1, IQ4_NL, MXFP4 and Q8_0 weights run on the Hexagon NPU; other formats on GPU/CPU.
                    GGUF files downloaded or imported for the llama.cpp engine are listed here too.
                </p>
            </div>

            <div>
                <span className="text-[11px] text-text-secondary">Compute unit</span>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                    {UNITS.map(unit => (
                        <button
                            key={unit.value}
                            onClick={() => onRuntimeChange(unit.value)}
                            disabled={busy}
                            className={`py-1.5 rounded-lg text-xs border transition-colors ${runtime === unit.value
                                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                        >
                            {unit.label}
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-text-tertiary mt-1">Auto tries the NPU, then the GPU, then the CPU.</p>
            </div>

            {models.length > 0 && (
                <div className="space-y-2">
                    {models.map(model => (
                        <GenieModelRow
                            key={model.path}
                            model={model}
                            isCurrent={currentPath === model.path}
                            disabled={busy}
                            onLoad={() => onLoad(model)}
                            onDelete={() => onDelete(model)}
                        />
                    ))}
                </div>
            )}

            {toDownload.length > 0 && (
                <div className="space-y-2">
                    <span className="text-[11px] text-text-secondary">Recommended for the NPU</span>
                    {toDownload.map(model => {
                        const p = progress[model.id];
                        return (
                            <div key={model.id} className="p-3 rounded-xl border bg-surface/40 border-white/5">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-text-primary">{model.name}</p>
                                        <p className="text-[11px] text-text-secondary mt-0.5">{formatFileSize(model.size)} • {model.description}</p>
                                    </div>
                                    <button
                                        onClick={() => (p ? onCancel(model) : onDownload(model))}
                                        className={`text-xs px-3 py-1.5 rounded-lg font-medium border ${p
                                            ? 'text-red-300 border-red-500/30 bg-red-500/10'
                                            : 'text-amber-300 border-amber-500/30 bg-amber-500/15'}`}
                                    >
                                        {p ? 'Cancel' : 'Download'}
                                    </button>
                                </div>
                                {p && (
                                    <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                        <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round(p.percentage)}%` }} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default GenieGgufSection;
