import React from 'react';
import { ModelDownloadProgress, formatFileSize } from '../../services/model/modelDownloader';

interface ModelDownloadCardProps {
    model: {
        name: string;
        id: string;
        url: string;
        size: number;
        description: string;
        category?: string;  // 'chat' | 'tool-use'
    };
    isDownloaded: boolean;
    isDownloading: boolean;
    progress?: ModelDownloadProgress;
    onDownload: () => void;
    onLoad: () => void;
    onLoadAsTool?: () => void;  // Optional callback for loading as tool model
    onDelete: () => void;
    onCancel: () => void;
    isLoaded: boolean;
    isLoadedAsTool?: boolean;  // Whether this model is loaded as tool model
}

const ModelDownloadCard: React.FC<ModelDownloadCardProps> = ({
    model,
    isDownloaded,
    isDownloading,
    progress,
    onDownload,
    onLoad,
    onLoadAsTool,
    onDelete,
    onCancel,
    isLoaded,
    isLoadedAsTool = false
}) => {
    const isToolCategory = model.category === 'tool-use';

    return (
        <div className="p-3 bg-surface/40 rounded-lg border border-white/5">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <h5 className="text-sm font-medium text-text-primary">{model.name}</h5>
                    <p className="text-xs text-text-secondary">{model.description}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">Size: {formatFileSize(model.size)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    {isLoaded && (
                        <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-[10px] rounded-full border border-green-500/30">
                            Chat ✓
                        </span>
                    )}
                    {isLoadedAsTool && (
                        <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] rounded-full border border-purple-500/30">
                            Tool 🔧
                        </span>
                    )}
                </div>
            </div>

            {isDownloading && progress && (
                <div className="mb-3 space-y-1">
                    <div className="flex justify-between text-[10px] text-text-secondary">
                        <span>Downloading...</span>
                        <span>{progress.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progress.percentage}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-[10px] text-text-tertiary">
                        <span>{formatFileSize(progress.bytesDownloaded)} / {formatFileSize(progress.totalBytes)}</span>
                        <button onClick={onCancel} className="text-red-400 hover:text-red-300">Cancel</button>
                    </div>
                </div>
            )}

            <div className="flex gap-2 mt-2">
                {!isDownloaded && !isDownloading && (
                    <button
                        onClick={onDownload}
                        className="flex-1 py-1.5 px-3 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded transition-colors border border-primary/30"
                    >
                        Download
                    </button>
                )}

                {isDownloaded && (
                    <>
                        {/* Load as Chat button */}
                        <button
                            onClick={onLoad}
                            disabled={isLoaded}
                            className={`flex-1 py-1.5 px-3 text-xs rounded transition-colors border ${isLoaded
                                ? 'bg-green-500/10 text-green-400 border-green-500/30 cursor-default'
                                : 'bg-primary/20 hover:bg-primary/30 text-primary border-primary/30'
                                }`}
                        >
                            {isLoaded ? 'Chat ✓' : (isToolCategory ? 'Load Chat' : 'Load')}
                        </button>

                        {/* Load as Tool button - show for all models when onLoadAsTool is provided */}
                        {onLoadAsTool && (
                            <button
                                onClick={onLoadAsTool}
                                disabled={isLoadedAsTool}
                                className={`py-1.5 px-3 text-xs rounded transition-colors border ${isLoadedAsTool
                                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30 cursor-default'
                                    : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/30'
                                    }`}
                            >
                                {isLoadedAsTool ? '🔧 Tool' : '🔧'}
                            </button>
                        )}

                        <button
                            onClick={onDelete}
                            disabled={isLoaded || isLoadedAsTool}
                            className={`py-1.5 px-3 text-xs rounded transition-colors border ${(isLoaded || isLoadedAsTool)
                                ? 'bg-white/5 text-white/30 border-white/5 cursor-not-allowed'
                                : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20'
                                }`}
                        >
                            🗑️
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default ModelDownloadCard;
