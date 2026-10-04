import React from 'react';
import type { GenieModelInfo } from 'genie-capacitor';
import { formatFileSize } from '../../../services/model/modelDownloader';

interface GenieModelRowProps {
    model: GenieModelInfo;
    isCurrent: boolean;
    disabled: boolean;
    onLoad: () => void;
    onDelete?: () => void;
}

/** A model on disk: name, weight format, where it runs (NPU or GPU/CPU), Load and Delete */
const GenieModelRow: React.FC<GenieModelRowProps> = ({ model, isCurrent, disabled, onLoad, onDelete }) => (
    <div className={`p-3 rounded-xl border transition-all ${isCurrent ? 'bg-amber-500/15 border-amber-500/50' : 'bg-surface/60 border-white/5 hover:border-white/20'}`}>
        <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 mr-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-text-primary truncate">{model.model_name || model.model_id}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">{model.precision || 'w4a16'}</span>
                    {model.npuReady ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-300">NPU</span>
                    ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-text-secondary" title="This weight format has no NPU kernels">GPU/CPU</span>
                    )}
                    {model.is_vision && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Vision</span>}
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                    {model.sizeBytes ? `${formatFileSize(model.sizeBytes)} • ` : ''}{model.path.split('/').pop()}
                </p>
            </div>
            <div className="flex items-center gap-1.5">
                {onDelete && !isCurrent && (
                    <button onClick={onDelete} disabled={disabled} className="text-xs text-red-400 hover:text-red-300 px-2 py-1.5 rounded-lg" aria-label="Delete model">
                        🗑
                    </button>
                )}
                <button
                    onClick={onLoad}
                    disabled={disabled || isCurrent}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${isCurrent
                        ? 'bg-amber-500/30 text-amber-200 cursor-default'
                        : 'bg-surface hover:bg-surface/80 text-text-primary border border-white/10'}`}
                >
                    {isCurrent ? 'Active' : 'Load'}
                </button>
            </div>
        </div>
    </div>
);

export default GenieModelRow;
