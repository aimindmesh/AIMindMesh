import React, { useState, useEffect } from 'react';
import { LLMConfig } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { RECOMMENDED_MODELS, downloadModel, modelExists, ModelDownloadProgress, getLocalGgufModels } from '../../../services/model/modelDownloader';
import { initNativeModel, getSlotModelInfo, unloadNativeModelSlot } from '../../../services/llm/nativeLLM';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { FileSystemAdapter as Filesystem, Directory } from '../../../utils/fileSystemAdapter';
import { logger } from '../../../services/logger';
import { TOOL_DEFINITIONS } from '../../../services/toolDefinitions';

interface AgenticSettingsProps {
    llmConfig: LLMConfig;
    onLlmConfigSave: (newConfig: LLMConfig) => void;
    hfToken: string;
}

const AgenticSettings: React.FC<AgenticSettingsProps> = ({
    llmConfig,
    onLlmConfigSave,
    hfToken
}) => {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, ModelDownloadProgress>>({});
    const [isToolModelLoaded, setIsToolModelLoaded] = useState(false);
    const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
    const [importedToolModels, setImportedToolModels] = useState<string[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    // Filter only tool-use models from recommended
    const toolUseModels = RECOMMENDED_MODELS.filter(m => m.category === 'tool-use');

    useEffect(() => {
        checkDownloadedModels();
        checkImportedModels();
        const info = getSlotModelInfo('tool');
        setIsToolModelLoaded(info.isLoaded && info.modelPath === llmConfig.toolUseModelPath);
    }, [llmConfig.toolUseModelPath]);

    const checkDownloadedModels = async () => {
        const downloaded: string[] = [];
        for (const model of toolUseModels) {
            const exists = await modelExists(model.id + '.gguf');
            if (exists) downloaded.push(model.id);
        }
        setDownloadedModels(downloaded);
    };

    const checkImportedModels = async () => {
        try {
            const allGgufFiles = await getLocalGgufModels();
            const recommendedFilenames = RECOMMENDED_MODELS.map(m => m.id + '.gguf');
            const imported = allGgufFiles.filter(filename => !recommendedFilenames.includes(filename));
            setImportedToolModels(imported);
        } catch (e) {
            console.error('Failed to list imported models', e);
        }
    };

    const handleImportToolModel = async () => {
        triggerHaptic();
        try {
            const result = await FilePicker.pickFiles({
                types: ['application/octet-stream'],
                readData: false,
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                const fileName = file.name;

                if (!fileName.endsWith('.gguf')) {
                    alert('Please select a .gguf file');
                    return;
                }

                setIsImporting(true);
                try {
                    const { importGgufFile } = await import('../../../services/model/modelDownloader');
                    await importGgufFile(file.path!);
                    await checkImportedModels();
                    alert(`Successfully imported: ${fileName}`);
                } finally {
                    setIsImporting(false);
                }
            }
        } catch (e) {
            setIsImporting(false);
            logger.log('error', 'Failed to import GGUF file', e);
            alert('Failed to import file: ' + (e as any).message);
        }
    };

    const handleLoadToolModel = async (modelId: string) => {
        triggerHaptic();
        // Keep the filename for config persistence (relative path is better for portability)
        const filename = modelId + '.gguf';
        try {
            console.log('[AgenticSettings] Loading tool model:', filename);

            // Resolve absolute path for the native layer (required on Android/Linux)
            const uriResult = await Filesystem.getUri({
                path: filename,
                directory: Directory.Data
            });

            // Strip file:// prefix if present
            const absolutePath = uriResult.uri.replace('file://', '');
            console.log('[AgenticSettings] Resolved absolute path:', absolutePath);

            // Initialize with the ABSOLUTE path
            await initNativeModel({
                modelPath: absolutePath,
                nCtx: 2048, // Explicitly set context for tool model
                nGpuLayers: llmConfig.nGpuLayers, // Respect GPU setting
            }, 'tool');

            // Save the RELATIVE filename to config (preserves restart behavior)
            onLlmConfigSave({ ...llmConfig, toolUseModelPath: filename });
            setIsToolModelLoaded(true);
        } catch (error) {
            console.error('Failed to load tool model:', error);
            alert('Failed to load tool model: ' + (error as any).message);
        }
    };

    const handleUnloadToolModel = async () => {
        triggerHaptic();
        try {
            await unloadNativeModelSlot('tool');
            onLlmConfigSave({ ...llmConfig, toolUseModelPath: undefined });
            setIsToolModelLoaded(false);
        } catch (error) {
            console.error('Failed to unload tool model:', error);
        }
    };

    const handleDownloadModel = async (model: typeof RECOMMENDED_MODELS[0]) => {
        triggerHaptic();
        const filename = model.id + '.gguf';
        try {
            setDownloadProgress(prev => ({
                ...prev,
                [model.id]: { bytesDownloaded: 0, totalBytes: model.size, percentage: 0, completed: false, failed: false }
            }));

            await downloadModel(model.url, filename, (progress) => {
                setDownloadProgress(prev => ({ ...prev, [model.id]: progress }));
            }, hfToken);

            await checkDownloadedModels();
            setDownloadProgress(prev => {
                const next = { ...prev };
                delete next[model.id];
                return next;
            });
        } catch (error) {
            console.error('Download failed:', error);
            setDownloadProgress(prev => {
                const next = { ...prev };
                delete next[model.id];
                return next;
            });
            alert('Download failed: ' + (error as any).message);
        }
    };

    // Group tools by category
    const groupedTools = TOOL_DEFINITIONS.reduce((acc, tool) => {
        if (!acc[tool.category]) acc[tool.category] = [];
        acc[tool.category].push(tool);
        return acc;
    }, {} as Record<string, typeof TOOL_DEFINITIONS>);

    const handleToolRuleChange = (toolName: string, rule: 'allow' | 'confirm' | 'deny') => {
        triggerHaptic();
        const currentRules = llmConfig.toolRules || {};
        onLlmConfigSave({
            ...llmConfig,
            toolRules: { ...currentRules, [toolName]: rule }
        });
    };

    return (
        <div className="space-y-6 animate-fade-in p-6">
            <fieldset>
                <legend className="text-base font-medium text-text-primary mb-3 flex items-center gap-2">
                    🔧 Agentic Mode (Tool Use)
                </legend>

                {/* Toggle 1: Enable Tool Use */}
                <div className="bg-purple-500/5 p-4 rounded-lg border border-purple-500/20 mb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-text-primary">Enable Tool Use</p>
                            <p className="text-xs text-text-secondary">Allow AI to execute actions (web search, app control, etc.)</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={llmConfig.enableToolCalling || false}
                                onChange={(e) => {
                                    triggerHaptic();
                                    onLlmConfigSave({ ...llmConfig, enableToolCalling: e.target.checked });
                                }}
                            />
                            <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                        </label>
                    </div>
                </div>

                {/* Nested content when tool use is enabled */}
                {llmConfig.enableToolCalling && (
                    <div className="space-y-4 pl-4 border-l-2 border-purple-500/30 animate-fade-in">

                        {/* NEW: Server-Side Intelligence Toggle */}
                        <div className="bg-blue-500/5 p-4 rounded-lg border border-blue-500/20 mb-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-text-primary">Server-Side Intelligence</p>
                                    <p className="text-xs text-text-secondary">Delegate complex reasoning and autonomous tasks to the server</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={llmConfig.serverSideAgenticEnabled || false}
                                        onChange={(e) => {
                                            triggerHaptic();
                                            onLlmConfigSave({ 
                                                ...llmConfig, 
                                                serverSideAgenticEnabled: e.target.checked,
                                                serverSideAgentProvider: e.target.checked ? (llmConfig.serverSideAgentProvider || 'openclaw') : undefined
                                            });
                                        }}
                                    />
                                    <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            {llmConfig.serverSideAgenticEnabled && (
                                <div className="pt-2 border-t border-blue-500/10 flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Agent Provider</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                triggerHaptic();
                                                onLlmConfigSave({ ...llmConfig, serverSideAgentProvider: 'openclaw' });
                                            }}
                                            className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                                (llmConfig.serverSideAgentProvider || 'openclaw') === 'openclaw'
                                                    ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                                                    : 'bg-surface border-white/10 text-text-secondary'
                                            }`}
                                        >
                                            🤖 OpenClaw
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                triggerHaptic();
                                                onLlmConfigSave({ ...llmConfig, serverSideAgentProvider: 'hermes' });
                                            }}
                                            className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                                llmConfig.serverSideAgentProvider === 'hermes'
                                                    ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                                                    : 'bg-surface border-white/10 text-text-secondary'
                                            }`}
                                        >
                                            🔮 Hermes Agent
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Toggle 2: Use Dedicated Tool Model */}
                        <div className="bg-surface/30 p-4 rounded-lg border border-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <p className="text-sm font-medium text-text-primary">Use Dedicated Tool Model</p>
                                    <p className="text-xs text-text-secondary">Load a specialized model (e.g., FunctionGemma) for tool calling</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={llmConfig.useDedicatedToolModel || false}
                                        onChange={(e) => {
                                            triggerHaptic();
                                            onLlmConfigSave({ ...llmConfig, useDedicatedToolModel: e.target.checked });
                                        }}
                                    />
                                    <div className="w-11 h-6 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                                </label>
                            </div>
                            <p className="text-[10px] text-text-tertiary">
                                When disabled, the main model's native tool-use capability will be used (if available).
                            </p>
                        </div>

                        {/* Tool Model Selection - only when useDedicatedToolModel is true */}
                        {llmConfig.useDedicatedToolModel && (
                            <div className="bg-surface/30 p-4 rounded-lg border border-blue-500/20 animate-fade-in">
                                <h5 className="text-sm font-semibold text-text-primary mb-3">Tool Model</h5>

                                {/* Active Tool Model Card */}
                                {llmConfig.toolUseModelPath && isToolModelLoaded ? (
                                    <div className="p-3 bg-surface/40 rounded-lg border border-purple-500/30 mb-3">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1 overflow-hidden">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                                                    <p className="text-xs text-text-secondary uppercase tracking-wider font-semibold">Active Tool Model</p>
                                                </div>
                                                <p className="text-sm font-medium text-text-primary mb-1 truncate" title={decodeURIComponent(llmConfig.toolUseModelPath)}>
                                                    {decodeURIComponent(llmConfig.toolUseModelPath).split('/').pop()?.replace('.gguf', '')}
                                                </p>
                                                <p className="text-[10px] text-purple-400">Ready for tool calling</p>
                                            </div>
                                            <button
                                                onClick={handleUnloadToolModel}
                                                className="ml-2 text-xs text-red-400 hover:text-red-300 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 rounded border border-red-500/20 transition-colors"
                                            >
                                                Unload
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 mb-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-lg">⚠️</span>
                                            <div>
                                                <p className="text-sm font-medium text-yellow-200">No Tool Model Loaded</p>
                                                <p className="text-[10px] text-yellow-200/80">Download and load a model below</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Tool Use Models List */}
                                <div className="space-y-2">
                                    {toolUseModels.map(model => {
                                        const isDownloaded = downloadedModels.includes(model.id);
                                        const isDownloading = !!downloadProgress[model.id];
                                        const isLoaded = llmConfig.toolUseModelPath === model.id + '.gguf' && isToolModelLoaded;

                                        return (
                                            <div key={model.id} className={`p-3 rounded-lg border ${isLoaded ? 'bg-purple-500/10 border-purple-500/40' : 'bg-surface/40 border-white/10'}`}>
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-sm font-medium text-text-primary">{model.name}</span>
                                                        </div>
                                                        <p className="text-xs text-text-secondary mb-1">{model.description}</p>
                                                        <p className="text-[10px] text-text-tertiary">~{Math.round(model.size / 1024 / 1024)}MB</p>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        {isLoaded ? (
                                                            <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Loaded</span>
                                                        ) : isDownloading ? (
                                                            <span className="text-xs text-blue-400 font-medium px-2 py-1 bg-blue-500/10 rounded">
                                                                {Math.round(downloadProgress[model.id].percentage)}%
                                                            </span>
                                                        ) : isDownloaded ? (
                                                            <button
                                                                onClick={() => handleLoadToolModel(model.id)}
                                                                className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded-lg transition-colors"
                                                            >
                                                                Load
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleDownloadModel(model)}
                                                                className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
                                                            >
                                                                Download
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Imported Models */}
                                {importedToolModels.length > 0 && (
                                    <div className="mt-4">
                                        <h6 className="text-xs font-semibold text-text-secondary mb-2">Imported Models</h6>
                                        <div className="space-y-2">
                                            {importedToolModels.map(filename => {
                                                const isLoaded = llmConfig.toolUseModelPath === filename && isToolModelLoaded;
                                                const cleanName = (() => {
                                                    try {
                                                        let name = decodeURIComponent(filename);
                                                        name = name.replace(/^primary:/, '').replace(/^raw:/, '');
                                                        return (name.split('/').pop() || name).replace('.gguf', '');
                                                    } catch {
                                                        return filename.replace('.gguf', '');
                                                    }
                                                })();

                                                return (
                                                    <div key={filename} className={`p-3 rounded-lg border ${isLoaded ? 'bg-purple-500/10 border-purple-500/40' : 'bg-surface/40 border-white/10'}`}>
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1 min-w-0 mr-3">
                                                                <p className="text-sm font-medium text-text-primary truncate" title={filename}>
                                                                    {cleanName}
                                                                </p>
                                                                <p className="text-xs text-text-secondary">Local Import</p>
                                                            </div>
                                                            {isLoaded ? (
                                                                <span className="text-xs text-green-400 font-medium px-2 py-1 bg-green-500/10 rounded">Loaded</span>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleLoadToolModel(filename.replace('.gguf', ''))}
                                                                    className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded-lg transition-colors"
                                                                >
                                                                    Load
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Import from storage button */}
                                <button
                                    onClick={handleImportToolModel}
                                    disabled={isImporting}
                                    className="w-full mt-4 py-2 px-4 bg-surface hover:bg-surface/80 border border-white/10 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    {isImporting ? (
                                        <span className="animate-pulse">Importing...</span>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                            </svg>
                                            Import GGUF File
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* Confirmation Mode */}
                        <div className="bg-surface/30 p-4 rounded-lg border border-white/5">
                            <label className="text-sm font-medium text-text-primary mb-2 block">Tool Autonomy (Confirmation Mode)</label>
                            <div className="grid grid-cols-3 gap-2">

                                <button
                                    type="button"
                                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, toolConfirmationMode: 'always' }); }}
                                    className={`py-2 px-3 rounded-lg border transition-all flex flex-col items-center gap-1
                                        ${(llmConfig.toolConfirmationMode || 'always') === 'always'
                                            ? 'bg-green-500/20 border-green-400 text-green-300'
                                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                                >
                                    <span className="text-base">🛡️</span>
                                    <span className="text-xs font-medium">Always</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, toolConfirmationMode: 'dangerous' }); }}
                                    className={`py-2 px-3 rounded-lg border transition-all flex flex-col items-center gap-1
                                        ${llmConfig.toolConfirmationMode === 'dangerous'
                                            ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                                >
                                    <span className="text-base">⚠️</span>
                                    <span className="text-xs font-medium">Risky Only</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { triggerHaptic(); onLlmConfigSave({ ...llmConfig, toolConfirmationMode: 'never' }); }}
                                    className={`py-2 px-3 rounded-lg border transition-all flex flex-col items-center gap-1
                                        ${llmConfig.toolConfirmationMode === 'never'
                                            ? 'bg-red-500/20 border-red-400 text-red-300'
                                            : 'bg-surface border-white/10 text-text-secondary hover:border-white/20'}`}
                                >
                                    <span className="text-base">🚀</span>
                                    <span className="text-xs font-medium">Never</span>
                                </button>
                            </div>
                            <p className="text-[10px] text-text-tertiary mt-2">
                                Control when the AI asks for permission before executing actions.
                            </p>
                        </div>

                        {/* Max Agent Iterations */}
                        <div className="bg-surface/30 p-4 rounded-lg border border-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-text-primary">Max Iterations</label>
                                <span className="text-sm font-mono text-purple-400">
                                    {llmConfig.maxAgentIterations || 5}
                                </span>
                            </div>
                            <input
                                type="range"
                                min={1}
                                max={15}
                                value={llmConfig.maxAgentIterations || 5}
                                onChange={(e) => {
                                    triggerHaptic();
                                    onLlmConfigSave({ ...llmConfig, maxAgentIterations: parseInt(e.target.value) });
                                }}
                                className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                            <p className="text-[10px] text-text-tertiary mt-2">
                                Maximum number of tool execution loops per request. Higher values allow more complex multi-step tasks.
                            </p>
                        </div>

                        {/* Tool Visibility Control */}
                        <div className="bg-surface/30 p-4 rounded-lg border border-white/5 space-y-4">
                            <h5 className="text-sm font-semibold text-text-primary">Tool Permissions</h5>
                            <p className="text-xs text-text-secondary mb-3">Configure how each tool can be used.</p>

                            {Object.entries(groupedTools).map(([category, tools]) => (
                                <div key={category} className="space-y-2">
                                    <h6 className="text-xs font-bold text-purple-400 uppercase tracking-wider pl-1 mt-2">{category}</h6>
                                    {tools.map(tool => {
                                        // Current rule state
                                        const currentRule = llmConfig.toolRules?.[tool.name];
                                        const isEnabled = currentRule !== 'deny';

                                        // Effective rule for display/logic (Auto vs Ask)
                                        const effectiveRule = currentRule === 'deny'
                                            ? (tool.requiresConfirmation ? 'confirm' : 'allow') // Fallback for when re-enabled
                                            : (currentRule || (
                                                llmConfig.toolConfirmationMode === 'never' ? 'allow' :
                                                    llmConfig.toolConfirmationMode === 'always' ? 'confirm' :
                                                        (tool.requiresConfirmation ? 'confirm' : 'allow')
                                            ));

                                        return (
                                            <div key={tool.name} className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isEnabled ? 'bg-surface/50 border-white/5' : 'bg-surface/20 border-white/5 opacity-60'}`}>
                                                <div className="flex-1 mr-4 min-w-0">
                                                    <p className={`text-sm font-medium transition-colors ${isEnabled ? 'text-text-primary' : 'text-text-secondary line-through'}`}>{tool.name}</p>
                                                    <p className="text-[10px] text-text-secondary line-clamp-1" title={tool.description}>{tool.description}</p>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    {/* Mode Selector - Only visible if Enabled */}
                                                    <div className={`flex bg-surface/80 rounded-lg p-0.5 border border-white/10 transition-all duration-300 ${isEnabled ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none w-0 overflow-hidden'}`}>
                                                        <button
                                                            onClick={() => handleToolRuleChange(tool.name, 'allow')}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${effectiveRule === 'allow' ? 'bg-green-500/20 text-green-400 shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
                                                        >
                                                            ⚡ Auto
                                                        </button>
                                                        <div className="w-px bg-white/5 my-1"></div>
                                                        <button
                                                            onClick={() => handleToolRuleChange(tool.name, 'confirm')}
                                                            className={`px-3 py-1.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${effectiveRule === 'confirm' ? 'bg-yellow-500/20 text-yellow-400 shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}
                                                        >
                                                            👁️ Ask
                                                        </button>
                                                    </div>

                                                    {/* Master Toggle */}
                                                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={isEnabled}
                                                            onChange={(e) => {
                                                                triggerHaptic();
                                                                if (e.target.checked) {
                                                                    // Re-enable: Remove 'deny' rule to fall back to global default, 
                                                                    // or set explicit 'confirm' if generally risky.
                                                                    // Let's reset to undefined (inherited) to be clean
                                                                    const newRules = { ...llmConfig.toolRules };
                                                                    delete newRules[tool.name];
                                                                    onLlmConfigSave({ ...llmConfig, toolRules: newRules });
                                                                } else {
                                                                    handleToolRuleChange(tool.name, 'deny');
                                                                }
                                                            }}
                                                        />
                                                        <div className="w-9 h-5 bg-surface border border-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white/50 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500 peer-checked:after:bg-white"></div>
                                                    </label>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                )
                }
            </fieldset >
        </div >
    );
};

export default AgenticSettings;
