import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { imageGenService } from '../../services/image/imageGenService';
import { triggerHaptic } from '../../services/native';
import { SDProgressEvent, SDGenerateResult, SDSampler } from 'sd-capacitor';
import { logger } from '../../services/logger';
import { StylePreset, STYLE_PRESETS } from './imageGenPresets';
import { ImageGenResultCard } from './ImageGenResultCard';
import { ImageGenAdvancedControls } from './ImageGenAdvancedControls';
import { useImageModelSession } from '../../hooks/useImageModelSession';

interface ImageGenModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInsertIntoChat?: (base64Image: string, prompt: string) => void;
    initialImage?: string; // Pre-loaded base64 or url when opened from chat message
    initialPrompt?: string;
}

export const ImageGenModal: React.FC<ImageGenModalProps> = ({
    isOpen,
    onClose,
    onInsertIntoChat,
    initialImage,
    initialPrompt = ''
}) => {
    const [mode, setMode] = useState<'txt2img' | 'img2img'>(initialImage ? 'img2img' : 'txt2img');
    const [prompt, setPrompt] = useState(initialPrompt);
    const [selectedPreset, setSelectedPreset] = useState<StylePreset>('photorealistic');
    const [negativePrompt, setNegativePrompt] = useState(STYLE_PRESETS[0].negative);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [steps, setSteps] = useState(25);
    const [cfgScale, setCfgScale] = useState(7.5);
    const [strength, setStrength] = useState(0.65);
    const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
    const [upscale, setUpscale] = useState<1 | 2 | 4>(1);
    const [sampler, setSampler] = useState<SDSampler>('euler');
    const [seed, setSeed] = useState<number | null>(null); // null: random every time
    const [sourceImage, setSourceImage] = useState<string | null>(initialImage || null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState<{ step: number; total: number; percent: number } | null>(null);
    const [result, setResult] = useState<SDGenerateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [installedModels, setInstalledModels] = useState<string[]>([]);
    const [isModelCheckDone, setIsModelCheckDone] = useState(false);
    const [saveStatus, setSaveStatus] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isSharing, setIsSharing] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    // Only Stable Diffusion in RAM while this screen is open (the LLM comes back on close)
    const { modelStatus, modelError, modelInfo } = useImageModelSession(isOpen);
    const imageExt = (img: string) => img.startsWith('data:image/jpeg') ? 'jpg' : 'png';
    const isModelSwitching = modelStatus === 'freeing' || modelStatus === 'loading';

    useEffect(() => {
        if (initialImage) {
            setSourceImage(initialImage);
            setMode('img2img');
        }
        if (initialPrompt) {
            setPrompt(initialPrompt);
        }
        if (isOpen) {
            import('../../services/image/sdModelDownloader').then(({ listLocalSDModels }) => {
                listLocalSDModels().then(models => {
                    setInstalledModels(models);
                    setIsModelCheckDone(true);
                }).catch(() => {
                    setIsModelCheckDone(true);
                });
            });
        }
    }, [initialImage, initialPrompt, isOpen]);

    if (!isOpen) return null;

    const handlePickImage = async () => {
        triggerHaptic();
        try {
            if (Capacitor.isNativePlatform()) {
                const pickResult = await FilePicker.pickImages({ limit: 1, readData: true });
                if (pickResult.files && pickResult.files.length > 0) {
                    const file = pickResult.files[0];
                    if (file.data) {
                        const base64Uri = file.data.startsWith('data:')
                            ? file.data
                            : `data:${file.mimeType || 'image/jpeg'};base64,${file.data}`;
                        setSourceImage(base64Uri);
                        setMode('img2img');
                        triggerHaptic();
                    }
                }
            } else {
                fileInputRef.current?.click();
            }
        } catch (err: any) {
            logger.log('warn', '[ImageGenModal] FilePicker error, trying input fallback', err);
            if (!err?.message?.includes('canceled') && !err?.message?.includes('dismissed')) {
                fileInputRef.current?.click();
            }
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                setSourceImage(reader.result);
                setMode('img2img');
                triggerHaptic();
            }
        };
        reader.readAsDataURL(file);
    };

    const handleSelectPreset = (presetId: StylePreset) => {
        setSelectedPreset(presetId);
        const preset = STYLE_PRESETS.find(p => p.id === presetId);
        if (preset) {
            setNegativePrompt(preset.negative);
        }
        triggerHaptic();
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            setError('Please enter a description for the image.');
            return;
        }

        setError(null);
        setIsGenerating(true);
        setProgress({ step: 0, total: steps, percent: 0 });
        triggerHaptic();

        try {
            const preset = STYLE_PRESETS.find(p => p.id === selectedPreset);
            let finalPrompt = prompt.trim();
            if (preset && preset.promptSuffix && !finalPrompt.toLowerCase().includes(preset.promptSuffix.toLowerCase().trim())) {
                finalPrompt += preset.promptSuffix;
            }

            const genResult = await imageGenService.generateImage({
                prompt: finalPrompt,
                negativePrompt: negativePrompt.trim(),
                sourceImage: mode === 'img2img' ? (sourceImage || undefined) : undefined,
                strength: mode === 'img2img' ? strength : undefined,
                steps,
                cfgScale,
                aspectRatio,
                upscale,
                sampler,
                seed: seed ?? -1,
                onProgress: (ev: SDProgressEvent) => {
                    const percent = Math.round((ev.step / ev.totalSteps) * 100);
                    setProgress({ step: ev.step, total: ev.totalSteps, percent });
                }
            });

            setResult(genResult);
            triggerHaptic();
        } catch (err: any) {
            logger.log('error', '[ImageGenModal] Generation error', err);
            setError(err.message || 'Image generation failed on Qualcomm NPU.');
        } finally {
            setIsGenerating(false);
            setProgress(null);
        }
    };

    const handleSaveImage = async () => {
        if (!result?.base64Image) return;
        setIsSaving(true);
        triggerHaptic();
        try {
            const rawBase64 = result.base64Image.replace(/^data:image\/\w+;base64,/, '');
            const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
            await Filesystem.writeFile({
                path: `AIMindMesh_SD_${timestamp}.${imageExt(result.base64Image)}`,
                data: rawBase64,
                directory: Directory.Documents,
                recursive: true,
            });
            setSaveStatus('Saved to Documents!');
            setTimeout(() => setSaveStatus(null), 3000);
        } catch (err) {
            try {
                const link = document.createElement('a');
                link.href = result.base64Image;
                link.download = `AIMindMesh_SD_${Date.now()}.${imageExt(result.base64Image)}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setSaveStatus('Saved to Downloads!');
                setTimeout(() => setSaveStatus(null), 3000);
            } catch {
                setError('Failed to save image.');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleShareImage = async () => {
        if (!result?.base64Image) return;
        setIsSharing(true);
        triggerHaptic();
        try {
            const rawBase64 = result.base64Image.replace(/^data:image\/\w+;base64,/, '');
            const fileRes = await Filesystem.writeFile({
                path: `AIMindMesh_SD_share_${Date.now()}.${imageExt(result.base64Image)}`,
                data: rawBase64,
                directory: Directory.Cache,
                recursive: true,
            });
            await Share.share({
                title: 'AI MindMesh Generation',
                text: prompt || 'Generated with Qualcomm NPU on AI MindMesh',
                url: fileRes.uri,
                dialogTitle: 'Share AI Image',
            });
        } catch (err: any) {
            if (err?.message && !err.message.includes('canceled') && !err.message.includes('dismissed')) {
                setError('Failed to share image.');
            }
        } finally {
            setIsSharing(false);
        }
    };

    const handleInsert = () => {
        if (!result) return;
        onInsertIntoChat?.(result.base64Image, prompt);
        triggerHaptic();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-surface/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden text-text-primary">
                
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-surface/50">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <span className="text-xl">🎨</span>
                        </div>
                        <div>
                            <h3 className="font-bold text-base text-text-primary flex items-center gap-1.5">
                                AI Image Studio
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    ⚡ NPU Hexagon
                                </span>
                            </h3>
                            <p className="text-xs text-text-secondary">On-device Stable Diffusion on Snapdragon NPU</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* No Model Warning Alert */}
                    {isModelCheckDone && installedModels.length === 0 && (
                        <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/30 flex items-start gap-3">
                            <span className="text-xl">⚠️</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-amber-300">No Stable Diffusion Model Installed</p>
                                <p className="text-[11px] text-text-secondary mt-0.5">
                                    To generate or edit images on the Qualcomm NPU, import a model ZIP package in Settings &gt; Vision &amp; Image Creation.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Mode Tabs */}
                    <div className="flex rounded-xl bg-surface/60 p-1 border border-white/5">
                        <button
                            type="button"
                            onClick={() => { setMode('txt2img'); triggerHaptic(); }}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                                mode === 'txt2img' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            ✨ Text to Image
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMode('img2img'); triggerHaptic(); }}
                            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                                mode === 'img2img' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm' : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            🖌️ Edit Image (img2img)
                        </button>
                    </div>

                    {/* Source Image Selector for img2img mode */}
                    {mode === 'img2img' && (
                        <div className="p-3 bg-surface/40 rounded-xl border border-white/10 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-text-primary flex items-center gap-1.5">🖼️ Source Image</label>
                                <span className="text-[10px] text-text-tertiary">To modify or restyle</span>
                            </div>

                            {modelInfo?.hasVaeEncoder === false && (
                                <p className="text-[11px] text-red-300">This model package has no vae_encoder.bin: it cannot edit images.</p>
                            )}
                            {sourceImage ? (
                                <div className="flex items-center gap-3 bg-surface/60 p-2 rounded-lg border border-white/5">
                                    <img src={sourceImage} alt="Source preview" className="w-16 h-16 object-cover rounded-md border border-white/10 bg-black" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-text-primary truncate">Source Image Loaded</p>
                                        <p className="text-[10px] text-text-tertiary">The result keeps its proportions</p>
                                        <div className="mt-1 flex items-center gap-2">
                                            <button type="button" onClick={handlePickImage} className="text-[11px] text-amber-300 hover:underline">Change</button>
                                            <span className="text-text-tertiary">•</span>
                                            <button type="button" onClick={() => setSourceImage(null)} className="text-[11px] text-red-400 hover:underline">Remove</button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handlePickImage}
                                    className="w-full py-6 border-2 border-dashed border-white/15 hover:border-amber-400/40 rounded-xl bg-surface/20 flex flex-col items-center justify-center gap-2 text-text-secondary hover:text-amber-300 transition-colors"
                                >
                                    <span className="text-2xl">📸</span>
                                    <span className="text-xs font-medium">Select or drop reference image</span>
                                </button>
                            )}

                            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />

                            {/* Strength Slider */}
                            {sourceImage && (
                                <div className="space-y-1 pt-1">
                                    <div className="flex justify-between text-[11px]">
                                        <span className="text-text-secondary">Transformation Strength:</span>
                                        <span className="text-amber-300 font-mono">{Math.round(strength * 100)}%</span>
                                    </div>
                                    <input type="range" min="0.1" max="0.95" step="0.05" value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))} className="w-full accent-amber-400" />
                                    <p className="text-[10px] text-text-tertiary">30-50% recolors/restyles keeping the layout; 70%+ reinvents it.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Aspect Ratio & Super-Resolution Selectors */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="p-2.5 bg-surface/40 rounded-xl border border-white/5 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-semibold text-text-primary flex items-center gap-1">
                                    📐 Aspect Ratio
                                </label>
                                <span className="text-[10px] text-amber-300 font-mono">{mode === 'img2img' ? 'source' : aspectRatio}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                                {(['1:1', '16:9', '9:16', '4:3'] as const).map((ratio) => (
                                    <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => { setAspectRatio(ratio); triggerHaptic(); }}
                                        disabled={mode === 'img2img'}
                                        className={`py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${
                                            aspectRatio === ratio
                                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                                                : 'bg-surface/60 text-text-secondary border-transparent hover:border-white/10'
                                        }`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="p-2.5 bg-surface/40 rounded-xl border border-white/5 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-semibold text-text-primary flex items-center gap-1">
                                    ⚡ AI Super-Res
                                </label>
                                <span className="text-[10px] text-amber-300 font-mono">{upscale === 1 ? '512px' : upscale === 2 ? '1024px' : '2048px'}{upscale > 1 && modelInfo?.hasSuperResolution === false ? ' (bilinear)' : ''}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {([
                                    { s: 1 as const, l: '1x' },
                                    { s: 2 as const, l: '2x' },
                                    { s: 4 as const, l: '4x' }
                                ]).map(({ s, l }) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => { setUpscale(s); triggerHaptic(); }}
                                        className={`py-1.5 rounded-lg text-[10px] font-semibold transition-all border ${
                                            upscale === s
                                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                                                : 'bg-surface/60 text-text-secondary border-transparent hover:border-white/10'
                                        }`}
                                    >
                                        {l}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Style Presets */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold text-text-primary flex items-center gap-1.5">
                                🎨 Style Preset
                            </label>
                            <span className="text-[10px] text-amber-300 font-mono">
                                {STYLE_PRESETS.find(p => p.id === selectedPreset)?.label}
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                            {STYLE_PRESETS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => handleSelectPreset(p.id)}
                                    className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all border ${
                                        selectedPreset === p.id
                                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                                            : 'bg-surface/60 text-text-secondary border-transparent hover:border-white/10'
                                    }`}
                                >
                                    <span>{p.icon}</span>
                                    <span>{p.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Prompt input */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-primary flex items-center justify-between">
                            <span>Image Prompt</span>
                            <span className="text-[10px] text-text-tertiary">
                                {prompt.length}/500 • Tip: (word:1.3) boosts weight
                            </span>
                        </label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={mode === 'img2img' ? "Describe the whole result, e.g. 'a watercolor painting of a house by a lake'..." : "A cute cat sitting near the window, cinematic lighting, photorealistic 8k..."}
                            rows={3}
                            maxLength={500}
                            className="w-full bg-input text-text-primary rounded-xl p-3 text-xs border border-white/10 focus:border-amber-400 focus:outline-none resize-none transition-colors"
                        />
                        <p className="text-[10px] text-text-tertiary">Write in English and describe the picture you want, not the change: Stable Diffusion does not follow instructions.</p>
                    </div>

                    {/* Advanced Settings Accordion */}
                    <ImageGenAdvancedControls
                        showAdvanced={showAdvanced}
                        setShowAdvanced={setShowAdvanced}
                        negativePrompt={negativePrompt}
                        setNegativePrompt={setNegativePrompt}
                        steps={steps}
                        setSteps={setSteps}
                        cfgScale={cfgScale}
                        setCfgScale={setCfgScale}
                        sampler={sampler}
                        setSampler={setSampler}
                        seed={seed}
                        setSeed={setSeed}
                    />

                    {/* Error display */}
                    {error && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                            <span>⚠️</span>
                            <span className="flex-1">{error}</span>
                        </div>
                    )}

                    {/* Model swap: the LLM leaves the RAM, Stable Diffusion is loaded */}
                    {isModelSwitching && !isGenerating && (
                        <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-text-secondary flex items-center gap-2">
                            <span className="animate-spin inline-block">⚙️</span>
                            {modelStatus === 'freeing' ? 'Freeing memory (unloading the chat model)…' : 'Loading the image model…'}
                        </div>
                    )}
                    {modelStatus === 'error' && modelError && installedModels.length > 0 && !error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300">{modelError}</div>
                    )}

                    {/* Progress Bar */}
                    {isGenerating && progress && (
                        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
                            <div className="flex justify-between text-xs font-semibold text-amber-300">
                                <span className="flex items-center gap-1.5">
                                    <span className="animate-spin inline-block">⚙️</span>
                                    Hexagon NPU Generating...
                                </span>
                                <span>Step {progress.step}/{progress.total} ({progress.percent}%)</span>
                            </div>
                            <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-white/5">
                                <div
                                    className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-200"
                                    style={{ width: `${progress.percent}%` }}
                                />
                            </div>
                            <p className="text-[10px] text-text-tertiary text-center">Synthesizing latents directly on Qualcomm CDSP</p>
                        </div>
                    )}

                    {/* Result Card */}
                    {result && !isGenerating && (
                        <ImageGenResultCard
                            result={result}
                            saveStatus={saveStatus}
                            isSaving={isSaving}
                            isSharing={isSharing}
                            onSave={handleSaveImage}
                            onShare={handleShareImage}
                            onReuseSeed={(s) => { setSeed(s); setShowAdvanced(true); triggerHaptic(); }}
                        />
                    )}
                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-white/10 bg-surface/80 flex items-center justify-between gap-2">
                    {result ? (
                        <>
                            <button
                                type="button"
                                onClick={handleGenerate}
                                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-text-primary transition-colors flex items-center gap-1.5"
                            >
                                🔁 Regenerate
                            </button>
                            <button
                                type="button"
                                onClick={handleInsert}
                                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-xs font-bold text-black transition-all shadow-lg flex items-center justify-center gap-1.5"
                            >
                                💬 Insert into Chat
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isGenerating || isModelSwitching || !prompt.trim()}
                            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold text-black transition-all shadow-lg flex items-center justify-center gap-2"
                        >
                            {isGenerating ? (
                                <>
                                    <span className="animate-spin">⚙️</span>
                                    <span>Generating on NPU...</span>
                                </>
                            ) : (
                                <>
                                    <span>⚡</span>
                                    <span>{mode === 'img2img' ? 'Modify Image on Qualcomm NPU' : 'Generate on Qualcomm NPU (~20s)'}</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ImageGenModal;
