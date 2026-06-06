import React from 'react';
import { SpeechConfig } from '../../../types';
import { useSTTModels } from '../../../hooks/useSTTModels';

// Sections
import { VoskModelSection } from './stt/VoskModelSection';
import { WhisperModelSection } from './stt/WhisperModelSection';
import { VADModelSection } from './stt/VADModelSection';
import { VoxtralModelSection } from './stt/VoxtralModelSection';
import STTProviderSelector from './stt/STTProviderSelector';
import { GeminiSTTSection } from './stt/GeminiSTTSection';

interface STTSettingsProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
    externalVoskModels: string[];
    onExternalVoskModelsChange: (models: string[] | ((prev: string[]) => string[])) => void;
    externalWhisperModels: string[];
    onExternalWhisperModelsChange: (models: string[] | ((prev: string[]) => string[])) => void;
    externalVADModels: string[];
    onExternalVADModelsChange: (models: string[] | ((prev: string[]) => string[])) => void;
    externalVoxtralModels: string[];
    onExternalVoxtralModelsChange: (models: string[] | ((prev: string[]) => string[])) => void;
    apiKey?: string;
}

const STTSettings: React.FC<STTSettingsProps> = ({
    speechConfig,
    onSpeechConfigChange,
    externalVoskModels,
    onExternalVoskModelsChange,
    externalWhisperModels,
    onExternalWhisperModelsChange,
    externalVADModels,
    onExternalVADModelsChange,
    externalVoxtralModels,
    onExternalVoxtralModelsChange,
    apiKey
}) => {
    const s = useSTTModels({
        vosk: externalVoskModels,
        onVoskChange: onExternalVoskModelsChange,
        whisper: externalWhisperModels,
        onWhisperChange: onExternalWhisperModelsChange,
        vad: externalVADModels,
        onVADChange: onExternalVADModelsChange,
        voxtral: externalVoxtralModels,
        onVoxtralChange: onExternalVoxtralModelsChange
    });

    return (
        <div className="space-y-6 animate-fade-in">
            <STTProviderSelector
                speechConfig={speechConfig}
                onSpeechConfigChange={onSpeechConfigChange}
            />

            {/* Gemini Online Configuration */}
            {speechConfig.sttProvider === 'online' && (
                <GeminiSTTSection
                    speechConfig={speechConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    apiKey={apiKey}
                />
            )}

            {/* Vosk Configuration - Only visible when Vosk is selected */}
            {speechConfig.sttProvider === 'vosk' && (
                <VoskModelSection
                    speechConfig={speechConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    downloadedModels={s.downloadedVoskModels}
                    onDownload={s.handleDownloadVoskModel}
                    onDelete={s.handleDeleteVoskModel}
                    onImport={s.handleImportVoskModel}
                    downloadProgress={s.downloadProgress}
                    isImporting={s.isImportingVosk}
                />
            )}

            {/* Voxtral Configuration - Only visible when Voxtral is selected */}
            {speechConfig.sttProvider === 'voxtral' && (
                <VoxtralModelSection
                    speechConfig={speechConfig}
                    onSpeechConfigChange={onSpeechConfigChange}
                    downloadedModels={s.downloadedVoxtralModels}
                    downloadedProjectors={s.downloadedVoxtralProjectors}
                    onImport={s.handleImportVoxtralModel}
                    onDelete={s.handleDeleteVoxtralModel}
                    isImporting={s.isImportingVoxtral}
                />
            )}

            {/* Whisper Configuration - Always visible for post-processing */}
            <WhisperModelSection
                speechConfig={speechConfig}
                onSpeechConfigChange={onSpeechConfigChange}
                downloadedModels={s.downloadedWhisperModels}
                onDownload={s.handleDownloadWhisperModel}
                onDelete={s.handleDeleteWhisperModel}
                onImport={s.handleImportWhisperModel}
                downloadProgress={s.downloadProgress}
                isImporting={s.isImportingWhisper}
            />

            {/* VAD Configuration - Always visible for post-processing */}
            <VADModelSection
                speechConfig={speechConfig}
                onSpeechConfigChange={onSpeechConfigChange}
                downloadedModels={s.downloadedVADModels}
                onDownload={s.handleDownloadVADModel}
                onDelete={s.handleDeleteVADModel}
                onImport={s.handleImportVADModel}
                downloadProgress={s.downloadProgress}
                isImporting={s.isImportingVAD}
            />
        </div>
    );
};

export default STTSettings;
