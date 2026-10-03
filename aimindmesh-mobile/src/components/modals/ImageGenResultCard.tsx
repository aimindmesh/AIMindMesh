import React from 'react';
import { SDGenerateResult } from 'sd-capacitor';

interface ImageGenResultCardProps {
    result: SDGenerateResult;
    saveStatus: string | null;
    isSaving: boolean;
    isSharing: boolean;
    onSave: () => void;
    onShare: () => void;
    /** Keeps this seed for the next generations (same composition, other prompt or settings) */
    onReuseSeed: (seed: number) => void;
}

export const ImageGenResultCard: React.FC<ImageGenResultCardProps> = ({
    result,
    saveStatus,
    isSaving,
    isSharing,
    onSave,
    onShare,
    onReuseSeed
}) => {
    return (
        <div className="p-3 bg-surface/50 rounded-xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-text-primary">Generated Result:</span>
                <span className="text-amber-300 text-[10px] font-mono">
                    ⚡ {result.generationTimeMs}ms ({result.width}x{result.height})
                </span>
            </div>
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg relative group">
                <img
                    src={result.base64Image}
                    alt="Generated output"
                    className="w-full h-auto object-contain max-h-72 mx-auto bg-black"
                />
                {result.seed !== undefined && (
                    <button
                        type="button"
                        onClick={() => onReuseSeed(result.seed!)}
                        className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/60 text-[10px] font-mono text-amber-200 border border-white/10"
                        title="Use this seed again"
                    >
                        🎲 {result.seed} · reuse
                    </button>
                )}
                {saveStatus && (
                    <div className="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-emerald-600/90 text-white text-[11px] font-medium shadow-lg backdrop-blur-sm animate-in fade-in flex items-center gap-1.5">
                        <span>✅</span> {saveStatus}
                    </div>
                )}
            </div>

            {result.promptTruncated && (
                <p className="text-[10px] text-amber-300">⚠️ The prompt was longer than 75 tokens: its end was ignored.</p>
            )}

            {/* Quick Actions for Result */}
            <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                    type="button"
                    onClick={onSave}
                    disabled={isSaving}
                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-text-primary transition-all flex items-center justify-center gap-1.5"
                >
                    <span>💾</span>
                    <span>{isSaving ? 'Saving...' : 'Save Image'}</span>
                </button>
                <button
                    type="button"
                    onClick={onShare}
                    disabled={isSharing}
                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-text-primary transition-all flex items-center justify-center gap-1.5"
                >
                    <span>📤</span>
                    <span>{isSharing ? 'Sharing...' : 'Share'}</span>
                </button>
            </div>
        </div>
    );
};
