import React, { useState, useEffect } from 'react';
import { getWakeWordService, WakeWordDebugDiagnostics } from '../../../services/wakeword';

interface WakeWordDiagnosticsProps {
    modelName: string;
}

export const WakeWordDiagnostics: React.FC<WakeWordDiagnosticsProps> = ({ modelName }) => {
    const [debugDiagnostics, setDebugDiagnostics] = useState<WakeWordDebugDiagnostics | null>(null);
    const [isDebugExpanded, setIsDebugExpanded] = useState(false);
    const [isLoadingDebug, setIsLoadingDebug] = useState(false);

    // Auto-refresh diagnostics when panel is expanded
    useEffect(() => {
        if (!isDebugExpanded || !modelName) return;

        console.log('🔄 Starting debug polling for:', modelName);
        const refreshDiagnostics = async () => {
            try {
                const service = getWakeWordService();
                const diag = await service.getDebugDiagnostics();
                setDebugDiagnostics(diag);
            } catch (err) {
                // Ignore polling errors
            }
        };

        refreshDiagnostics(); // Initial fetch
        const intervalId = setInterval(refreshDiagnostics, 200); // 200ms poll for smooth updates
        return () => clearInterval(intervalId);
    }, [isDebugExpanded, modelName]);

    if (!modelName) return null;

    return (
        <div className="mt-3">
            <button
                onClick={() => {
                    setIsDebugExpanded(!isDebugExpanded);
                }}
                className="w-full py-2 px-3 bg-purple-700/30 hover:bg-purple-700/50 text-purple-300 rounded-lg flex items-center justify-center gap-2 transition-colors border border-purple-500/30"
            >
                <span>🔬</span> {isDebugExpanded ? 'Hide' : 'Show'} Debug Diagnostics
            </button>

            {isDebugExpanded && (
                <div className="mt-2 bg-gray-900 rounded-lg p-3 border border-purple-500/20 text-xs">
                    {isLoadingDebug ? (
                        <div className="text-center text-gray-400 py-4 animate-pulse">
                            Loading diagnostics...
                        </div>
                    ) : !debugDiagnostics?.available ? (
                        <div className="text-center text-yellow-400 py-4">
                            ⚠️ {debugDiagnostics?.error || 'No diagnostics available. Start a test first to capture data.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Debug Info */}
                            {debugDiagnostics.debugInfo && (
                                <div className="p-2 bg-gray-800 rounded border border-gray-600 text-xs text-gray-400 break-all font-mono">
                                    ℹ️ {debugDiagnostics.debugInfo}
                                </div>
                            )}

                            {/* Template (Enrollment) Section */}
                            <div>
                                <h5 className="text-purple-300 font-medium mb-1">📝 Enrollment Template</h5>
                                <div className="grid grid-cols-2 gap-2 text-gray-300">
                                    <div>
                                        <span className="text-gray-500">Magnitude:</span>{' '}
                                        <span className="font-mono text-white">{debugDiagnostics.templateMagnitude?.toFixed(4)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Dimension:</span>{' '}
                                        <span className="font-mono text-white">{debugDiagnostics.templateDimension}</span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <span className="text-gray-500">First 10:</span>{' '}
                                    <span className="font-mono text-xs text-gray-400 break-all">
                                        [{debugDiagnostics.templateFirst10?.map(v => v.toFixed(3)).join(', ')}]
                                    </span>
                                </div>
                            </div>

                            {/* Live Embedding Section */}
                            <div>
                                <h5 className="text-blue-300 font-medium mb-1">🎤 Live Embedding (Last)</h5>
                                <div className="grid grid-cols-2 gap-2 text-gray-300">
                                    <div>
                                        <span className="text-gray-500">Magnitude:</span>{' '}
                                        <span className="font-mono text-white">{debugDiagnostics.lastEmbeddingMagnitude?.toFixed(4)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">RMS:</span>{' '}
                                        <span className="font-mono text-white">{debugDiagnostics.lastRms?.toFixed(6)}</span>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <span className="text-gray-500">First 10:</span>{' '}
                                    <span className="font-mono text-xs text-gray-400 break-all">
                                        [{debugDiagnostics.lastEmbeddingFirst10?.map(v => v.toFixed(3)).join(', ')}]
                                    </span>
                                </div>
                            </div>

                            {/* Similarity Section */}
                            <div className="border-t border-gray-700 pt-2">
                                <h5 className="text-green-300 font-medium mb-1">📊 Similarity Analysis</h5>
                                <div className="grid grid-cols-2 gap-2 text-gray-300">
                                    <div>
                                        <span className="text-gray-500">Similarity:</span>{' '}
                                        <span className={`font-mono font-bold ${(debugDiagnostics.similarity || 0) > (debugDiagnostics.threshold || 0.5) ? 'text-green-400' : 'text-red-400'}`}>
                                            {debugDiagnostics.similarity?.toFixed(4)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Threshold:</span>{' '}
                                        <span className="font-mono text-yellow-400">{debugDiagnostics.threshold?.toFixed(2)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">VAD Prob:</span>{' '}
                                        <span className="font-mono text-white">{(debugDiagnostics.vadProbability || 0).toFixed(3)}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500">Buffer:</span>{' '}
                                        <span className="font-mono text-white">{debugDiagnostics.bufferSize}</span>
                                    </div>
                                    <div className="col-span-2 flex justify-between px-1 border-t border-gray-700 pt-1 mt-1">
                                        <span className="text-gray-500">Consecutive:</span>{' '}
                                        <span className={`font-mono font-bold ${(debugDiagnostics.consecutiveDetections || 0) >= (debugDiagnostics.minConsecutiveFrames || 8) ? 'text-green-400' : 'text-yellow-400'}`}>
                                            {debugDiagnostics.consecutiveDetections}<span className="text-gray-500">/</span>{debugDiagnostics.minConsecutiveFrames}
                                        </span>
                                    </div>
                                </div>
                                <div className="mt-2 text-center py-1 rounded">
                                    {debugDiagnostics.isMatch ? (
                                        <span className="text-green-400 font-bold">✅ MATCH</span>
                                    ) : (
                                        <span className="text-red-400 font-bold">❌ NO MATCH</span>
                                    )}
                                    <span className="text-gray-500 ml-2">
                                        ({debugDiagnostics.enrollmentSampleCount} samples enrolled)
                                    </span>
                                </div>
                            </div>

                            {/* Refresh Button */}
                            <button
                                onClick={async () => {
                                    setIsLoadingDebug(true);
                                    try {
                                        const service = getWakeWordService();
                                        const diag = await service.getDebugDiagnostics();
                                        setDebugDiagnostics(diag);
                                    } catch (err) {
                                        console.error('Failed to refresh diagnostics:', err);
                                    } finally {
                                        setIsLoadingDebug(false);
                                    }
                                }}
                                className="w-full py-1 px-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors"
                            >
                                🔄 Refresh
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
