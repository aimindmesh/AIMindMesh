import React from 'react';
import { LLMConfig } from '../../../types';
import { useNativeModels } from '../../../hooks/useNativeModels';
import { useNativeModelLoader } from '../../../hooks/useNativeModelLoader';
import EngineSelector from './EngineSelector';
import GGUFSettings from './GGUFSettings';
import LiteRTSettings from './LiteRTSettings';

interface NativeModelSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (config: LLMConfig) => void;
    hfToken: string;
    onHfTokenChange: (token: string) => void;
    triggerHaptic: () => void;
}

const NativeModelSettings: React.FC<NativeModelSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    hfToken,
    onHfTokenChange,
    triggerHaptic
}) => {
    const modelsState = useNativeModels(llmConfig, onLlmConfigSave, hfToken, triggerHaptic);
    const loaderState = useNativeModelLoader(llmConfig, onLlmConfigSave, triggerHaptic);

    return (
        <div className="space-y-4 bg-green-500/5 p-4 rounded-lg border border-green-500/20">
            <EngineSelector
                llmConfig={llmConfig}
                onLlmConfigSave={onLlmConfigSave}
                triggerHaptic={triggerHaptic}
            />

            {llmConfig.engine === 'litert' ? (
                <LiteRTSettings
                    llmConfig={llmConfig}
                    onLlmConfigSave={onLlmConfigSave}
                    hfToken={hfToken}
                    triggerHaptic={triggerHaptic}
                    downloadProgress={modelsState.downloadProgress}
                    setDownloadProgress={modelsState.setDownloadProgress}
                    downloadedLiteRTModels={modelsState.downloadedLiteRTModels}
                    setDownloadedLiteRTModels={modelsState.setDownloadedLiteRTModels}
                    externalLiteRTModels={modelsState.externalLiteRTModels}
                    isImporting={modelsState.isImporting}
                    handleDeleteLiteRTModel={modelsState.handleDeleteLiteRTModel}
                    handleDeleteExternalLiteRTModel={modelsState.handleDeleteExternalLiteRTModel}
                    handleImportLiteRTFile={modelsState.handleImportLiteRTFile}
                />
            ) : (
                <GGUFSettings
                    llmConfig={llmConfig}
                    onLlmConfigSave={onLlmConfigSave}
                    hfToken={hfToken}
                    onHfTokenChange={onHfTokenChange}
                    triggerHaptic={triggerHaptic}
                    downloadProgress={modelsState.downloadProgress}
                    downloadedModels={modelsState.downloadedModels}
                    importedModels={modelsState.importedModels}
                    externalModels={modelsState.externalModels}
                    isImporting={modelsState.isImporting}
                    isNativeModelLoaded={loaderState.isNativeModelLoaded}
                    handleDownloadModel={modelsState.handleDownloadModel}
                    handleCancelDownload={modelsState.handleCancelDownload}
                    handleDeleteModel={modelsState.handleDeleteModel}
                    handleDeleteExternalModel={modelsState.handleDeleteExternalModel}
                    handleLoadNativeModel={loaderState.handleLoadNativeModel}
                    handleUnloadNativeModel={loaderState.handleUnloadNativeModel}
                    handleImportGgufFile={() => modelsState.handleImportGgufFile(loaderState.handleLoadNativeModel)}
                />
            )}
        </div>
    );
};

export default NativeModelSettings;
