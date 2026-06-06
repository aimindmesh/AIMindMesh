import React from 'react';
import { getWakeWordService, WakeWordModelInfo } from '../../../services/wakeword';
import { fileImportService } from '../../../services/file/fileImportService';
import { logger } from '../../../services/logger';

interface WakeWordImportProps {
    onModelsUpdated: (models: WakeWordModelInfo[], baseStatus: { hasMelSpectrogram: boolean; hasEmbedding: boolean }) => void;
    baseModelsStatus: { hasMelSpectrogram: boolean; hasEmbedding: boolean };
}

export const WakeWordImport: React.FC<WakeWordImportProps> = ({
    onModelsUpdated,
    baseModelsStatus
}) => {

    const handleImportSuccess = async () => {
        const service = getWakeWordService();
        const models = await service.getAvailableModels();
        const baseStatus = await service.checkBaseModels();
        onModelsUpdated(models, baseStatus);
    };

    return (
        <>
            <div className="grid grid-cols-1 gap-2 mt-2">
                <button
                    onClick={async () => {
                        try {
                            try {
                                const { releaseAllResources } = await import('../../../services/utils/memoryUtils');
                                await releaseAllResources();
                            } catch (err) { }

                            const picked = await fileImportService.pickFile({
                                types: ['application/zip'],
                                extensions: ['zip'],
                                destinationDirectory: 'wakeword-models'
                            });

                            if (picked && picked.success) {
                                const service = getWakeWordService();
                                await service.importModelZip(picked.path, picked.cleanName);
                                await handleImportSuccess();
                                alert(`Successfully imported: ${picked.cleanName}`);
                            }
                        } catch (e) {
                            logger.log('error', 'Failed to import model', e);
                            alert('Import failed: ' + (e as any).message);
                        }
                    }}
                    className="w-full py-2 px-3 bg-surface border border-gray-600 rounded-lg text-sm text-gray-300 hover:text-white hover:border-primary transition-colors flex items-center justify-center gap-2"
                >
                    <span>📥</span> Import Model from ZIP
                </button>

                <button
                    onClick={async () => {
                        try {
                            try {
                                const { releaseAllResources } = await import('../../../services/utils/memoryUtils');
                                await releaseAllResources();
                            } catch (err) {
                                logger.log('warn', 'Memory cleanup had issues', err);
                            }

                            const picked = await fileImportService.pickFile({
                                extensions: ['tflite', 'onnx'],
                                destinationDirectory: 'wakeword-models'
                            });

                            if (picked && picked.success) {
                                const service = getWakeWordService();
                                await service.copyModelFile(picked.path, picked.cleanName);
                                await handleImportSuccess();
                                alert(`Successfully imported: ${picked.cleanName}`);
                            }
                        } catch (e) {
                            logger.log('error', 'Failed to import single model', e);
                            alert('Import failed: ' + (e as any).message);
                        }
                    }}
                    className="w-full py-2 px-3 bg-surface border border-gray-600 rounded-lg text-sm text-gray-300 hover:text-white hover:border-primary transition-colors flex items-center justify-center gap-2"
                >
                    <span>📥</span> Import Single Model (.tflite)
                </button>
            </div>

            {/* Import buttons for missing base models */}
            {(!baseModelsStatus.hasMelSpectrogram || !baseModelsStatus.hasEmbedding) && (
                <div className="mt-2 p-2 border border-yellow-500/30 rounded bg-yellow-500/10">
                    <p className="text-xs text-yellow-200 mb-2 font-medium">Missing Base Models:</p>
                    <div className="grid grid-cols-2 gap-2">
                        {!baseModelsStatus.hasMelSpectrogram && (
                            <button
                                onClick={async () => {
                                    try {
                                        try {
                                            const { releaseAllResources } = await import('../../../services/utils/memoryUtils');
                                            await releaseAllResources();
                                        } catch (i) { }

                                        const picked = await fileImportService.pickFile({
                                            extensions: ['tflite'],
                                            destinationDirectory: 'wakeword-models'
                                        });

                                        if (picked && picked.success) {
                                            const s = getWakeWordService();
                                            await s.copyModelFile(picked.path, 'melspectrogram.tflite');
                                            // Trigger update
                                            const service = getWakeWordService();
                                            onModelsUpdated(await service.getAvailableModels(), await service.checkBaseModels());
                                            alert('Imported melspectrogram.tflite');
                                        }
                                    } catch (e) { alert('Failed: ' + (e as any).message); }
                                }}
                                className="text-xs py-2 px-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-white"
                            >
                                Import melspectrogram.tflite
                            </button>
                        )}
                        {!baseModelsStatus.hasEmbedding && (
                            <button
                                onClick={async () => {
                                    try {
                                        try {
                                            const { releaseAllResources } = await import('../../../services/utils/memoryUtils');
                                            await releaseAllResources();
                                        } catch (i) { }

                                        const picked = await fileImportService.pickFile({
                                            extensions: ['tflite'],
                                            destinationDirectory: 'wakeword-models'
                                        });

                                        if (picked && picked.success) {
                                            const s = getWakeWordService();
                                            await s.copyModelFile(picked.path, 'embedding_model.tflite');
                                            // setBaseModelsStatus(await s.checkBaseModels());
                                            const service = getWakeWordService();
                                            onModelsUpdated(await service.getAvailableModels(), await service.checkBaseModels());
                                            alert('Imported embedding_model.tflite');
                                        }
                                    } catch (e) { alert('Failed: ' + (e as any).message); }
                                }}
                                className="text-xs py-2 px-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-white"
                            >
                                Import embedding_model.tflite
                            </button>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};
