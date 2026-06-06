import React, { useState, useEffect } from 'react';
import { getWakeWordService, WakeWordModelInfo } from '../../../services/wakeword';
import { logger } from '../../../services/logger';
import { CustomWakeWordWizard } from './CustomWakeWordWizard';
import { WakeWordControls } from './WakeWordControls';
import { WakeWordDiagnostics } from './WakeWordDiagnostics';
import { WakeWordModelList } from './WakeWordModelList';
import { WakeWordImport } from './WakeWordImport';
import { WakeWordTest } from './WakeWordTest';
import { WakeWordBaseModels } from './WakeWordBaseModels';


export interface WakeWordSettingsProps {
    /** Whether wake word is enabled */
    enabled: boolean;
    /** Callback when enabled state changes */
    onEnabledChange: (enabled: boolean) => void;
    /** Selected wake word model */
    modelName: string;
    /** Callback when model changes */
    onModelChange: (modelName: string) => void;
    /** Detection threshold (0.0 - 1.0) */
    threshold: number;
    /** Callback when threshold changes */
    onThresholdChange: (threshold: number) => void;
    /** Cooldown between detections in ms */
    cooldownMs: number;
    /** Callback when cooldown changes */
    onCooldownChange: (cooldownMs: number) => void;
    /** Buffer size in chunks */
    bufferSize: number;
    /** Callback when buffer size changes */
    onBufferSizeChange: (bufferSize: number) => void;
    /** Consecutive frames for custom models */
    consecutiveFrames?: number;
    /** Callback when consecutive frames changes */
    onConsecutiveFramesChange?: (frames: number) => void;
}

export const WakeWordSettings: React.FC<WakeWordSettingsProps> = ({
    enabled,
    onEnabledChange,
    modelName,
    onModelChange,
    threshold,
    onThresholdChange,
    cooldownMs,
    onCooldownChange,
    bufferSize,
    onBufferSizeChange,
    consecutiveFrames = 8,
    onConsecutiveFramesChange,
}) => {
    const [availableModels, setAvailableModels] = useState<WakeWordModelInfo[]>([]);
    const [baseModelsStatus, setBaseModelsStatus] = useState<{
        hasMelSpectrogram: boolean;
        hasEmbedding: boolean;
    }>({ hasMelSpectrogram: false, hasEmbedding: false });
    const [isLoading, setIsLoading] = useState(true);
    const [isPluginAvailable, setIsPluginAvailable] = useState(false);
    const [isWizardOpen, setIsWizardOpen] = useState(false);

    // Load available models and check base models on mount
    useEffect(() => {
        const loadModelsInfo = async () => {
            setIsLoading(true);
            try {
                const service = getWakeWordService();
                const available = await service.ensureAvailable();
                setIsPluginAvailable(available);

                if (available) {
                    const models = await service.getAvailableModels();
                    setAvailableModels(models);

                    const baseStatus = await service.checkBaseModels();
                    setBaseModelsStatus(baseStatus);
                }
            } catch (error) {
                logger.log('error', 'Failed to load wake word models info', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadModelsInfo();
    }, []);

    const hasRequiredBaseModels = baseModelsStatus.hasMelSpectrogram && baseModelsStatus.hasEmbedding;
    const selectedModelInfo = availableModels.find(m => m.name === modelName);

    const handleDeleteModel = async (modelToDelete: string, displayName: string) => {
        if (confirm(`Are you sure you want to delete "${displayName}"?`)) {
            try {
                const service = getWakeWordService();
                await service.deleteModel(modelToDelete);

                // Refresh list
                const models = await service.getAvailableModels();
                setAvailableModels(models);

                // If we deleted the currently selected model, select the first available or clear selection
                if (modelName === modelToDelete) {
                    if (models.length > 0) {
                        onModelChange(models[0].name);
                    } else {
                        onModelChange("");
                    }
                }
                alert("Model deleted successfully");
            } catch (e) {
                alert("Failed to delete model: " + (e as any).message);
            }
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span>🎤</span> Wake Word
                </h3>
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            </div>
        );
    }

    if (!isPluginAvailable) {
        return (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span>🎤</span> Wake Word
                </h3>
                <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-4">
                    <p className="text-yellow-200 text-sm">
                        Wake word detection is not available on this platform.
                        It requires the native Android plugin.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>🎤</span> Wake Word
            </h3>

            {/* Custom Wake Word Wizard */}
            <CustomWakeWordWizard
                isOpen={isWizardOpen}
                onClose={() => setIsWizardOpen(false)}
                onSuccess={async (name) => {
                    // Reload models to see the new one
                    const service = getWakeWordService();
                    const models = await service.getAvailableModels();
                    setAvailableModels(models);

                    // Select the new model
                    onModelChange(`custom:${name}`);
                    alert(`Custom wake word "${name}" created and selected!`);
                }}
            />

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
                <div>
                    <span className="text-textPrimary">Enable Wake Word</span>
                    <p className="text-xs textSecondary mt-1">
                        Say the wake word to activate voice mode.
                        <br />
                        <span className="text-blue-400 cursor-pointer hover:underline" onClick={() => {
                            alert('To use as system assistant: Go to Android Settings > Apps > Default Apps > Digital Assistant app > Default digital assistant app and select AI Mind Mesh.');
                        }}>
                            Configure as Default Assistant
                        </span>
                    </p>
                </div>
                <button
                    onClick={() => onEnabledChange(!enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-white/10'
                        }`}
                    disabled={!hasRequiredBaseModels}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                    />
                </button>
            </div>

            {/* Base Models Status */}
            <WakeWordBaseModels
                baseModelsStatus={baseModelsStatus}
                hasRequiredBaseModels={hasRequiredBaseModels}
            />

            {/* Model Selection and List */}
            <WakeWordModelList
                modelName={modelName}
                onModelChange={onModelChange}
                availableModels={availableModels}
                isPluginAvailable={isPluginAvailable}
                hasRequiredBaseModels={hasRequiredBaseModels}
                setIsWizardOpen={setIsWizardOpen}
                onDeleteModel={handleDeleteModel}
            />

            {/* Import Models */}
            <WakeWordImport
                baseModelsStatus={baseModelsStatus}
                onModelsUpdated={(models, status) => {
                    setAvailableModels(models);
                    setBaseModelsStatus(status);
                }}
            />

            {hasRequiredBaseModels && (
                <>
                    {/* Controls */}
                    <WakeWordControls
                        threshold={threshold}
                        onThresholdChange={onThresholdChange}
                        cooldownMs={cooldownMs}
                        onCooldownChange={onCooldownChange}
                        bufferSize={bufferSize}
                        onBufferSizeChange={onBufferSizeChange}
                        consecutiveFrames={consecutiveFrames}
                        onConsecutiveFramesChange={onConsecutiveFramesChange}
                        modelName={modelName}
                    />

                    {/* Test Recognition */}
                    {modelName && (
                        <WakeWordTest
                            modelName={modelName}
                            threshold={threshold}
                            cooldownMs={cooldownMs}
                            bufferSize={bufferSize}
                            selectedModelDisplayName={selectedModelInfo?.displayName}
                        />
                    )}

                    {/* Diagnostics */}
                    {modelName && (
                        <WakeWordDiagnostics modelName={modelName} />
                    )}
                </>
            )}
        </div >
    );
};

export default WakeWordSettings;