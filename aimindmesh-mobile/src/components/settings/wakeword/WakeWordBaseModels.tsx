import React from 'react';
import { BASE_MODELS } from '../../../services/wakeword';

interface WakeWordBaseModelsProps {
    baseModelsStatus: {
        hasMelSpectrogram: boolean;
        hasEmbedding: boolean;
    };
    hasRequiredBaseModels: boolean;
}

export const WakeWordBaseModels: React.FC<WakeWordBaseModelsProps> = ({
    baseModelsStatus,
    hasRequiredBaseModels
}) => {
    return (
        <div className={`border rounded-lg p-4 ${hasRequiredBaseModels ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/20 border-red-500/50'}`}>
            <div className="flex items-center justify-between mb-2">
                <p className={`text-sm font-medium ${hasRequiredBaseModels ? 'text-green-200' : 'text-red-200'}`}>
                    {hasRequiredBaseModels ? '✅ Base Models Ready' : '⚠️ Missing Base Models'}
                </p>
            </div>

            {!hasRequiredBaseModels && (
                <p className="text-red-200/80 text-xs mb-3">
                    Wake word detection requires two base models. Please download them from the
                    OpenWakeWord repository and place them in the app's models directory, or import them via ZIP below.
                </p>
            )}

            <ul className="text-xs space-y-1">
                <li className={baseModelsStatus.hasMelSpectrogram ? 'text-green-400' : 'text-red-300'}>
                    {baseModelsStatus.hasMelSpectrogram ? '✓' : '✗'} {BASE_MODELS.MEL_SPECTROGRAM}
                </li>
                <li className={baseModelsStatus.hasEmbedding ? 'text-green-400' : 'text-red-300'}>
                    {baseModelsStatus.hasEmbedding ? '✓' : '✗'} {BASE_MODELS.EMBEDDING}
                </li>
            </ul>

            {!hasRequiredBaseModels && (
                <a
                    href="https://github.com/dscripka/openWakeWord/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
                >
                    Download from GitHub →
                </a>
            )}
        </div>
    );
};
