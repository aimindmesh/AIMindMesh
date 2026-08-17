import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { imageGenService } from '../../services/image/imageGenService';
import { triggerHaptic } from '../../services/native';
import { SDProgressEvent, SDGenerateResult } from 'sd-capacitor';
import { logger } from '../../services/logger';

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
    const [negativePrompt, setNegativePrompt] = useState('blurry, distorted, low quality, bad anatomy, deformed');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [steps, setSteps] = useState(25);
    const [cfgScale, setCfgScale] = useState(7.5);
    const [strength, setStrength] = useState(0.65);
    const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1');
    const [upscale, setUpscale] = useState<1 | 2 | 4>(1);
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
            const genResult = await imageGenService.generateImage({
                prompt: prompt.trim(),
                negativePrompt: negativePrompt.trim(),
                sourceImage: mode === 'img2img' ? (sourceImage || undefined) : undefined,
                strength: mode === 'img2img' ? strength : undefined,
                steps,
                cfgScale,
                aspectRatio,
                upscale,
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
                path: `AIMindMesh_SD_${timestamp}.png`,
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
                link.download = `AIMindMesh_SD_${Date.now()}.png`;
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
                path: `AIMindMesh_SD_share_${Date.now()}.png`,
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

                            {sourceImage ? (
                                <div className="flex items-center gap-3 bg-surface/60 p-2 rounded-lg border border-white/5">
                                    <img src={sourceImage} alt="Source preview" className="w-16 h-16 object-cover rounded-md border border-white/10 bg-black" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-text-primary truncate">Source Image Loaded</p>
                                        <p className="text-[10px] text-text-tertiary">512x512 normalized</p>
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
                                    <p className="text-[10px] text-text-tertiary">Lower preserves original shape; higher invents new details.</p>
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
                                <span className="text-[10px] text-amber-300 font-mono">{aspectRatio}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1">
                                {(['1:1', '16:9', '9:16', '4:3'] as const).map((ratio) => (
                                    <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => { setAspectRatio(ratio); triggerHaptic(); }}
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
                                <span className="text-[10px] text-amber-300 font-mono">{upscale === 1 ? '512px' : upscale === 2 ? '1024px' : '2048px'}</span>
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

                    {/* Prompt input */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-text-primary flex items-center justify-between">
                            <span>Image Prompt</span>
                            <span className="text-[10px] text-text-tertiary">{prompt.length}/500</span>
                        </label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder={mode === 'img2img' ? "Describe modifications (e.g. 'Turn into a watercolor oil painting')..." : "A cute cat sitting near the window, cinematic lighting, photorealistic 8k..."}
                            rows={3}
                            maxLength={500}
                            className="w-full bg-input text-text-primary rounded-xl p-3 text-xs border border-white/10 focus:border-amber-400 focus:outline-none resize-none transition-colors"
                        />
                    </div>

                    {/* Advanced Settings Accordion */}
                    <div>
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 transition-colors"
                        >
                            <span>{showAdvanced ? '▼' : '▶'}</span>
                            <span>Advanced Controls (Steps, CFG Scale, Negative Prompt)</span>
                        </button>

                        {showAdvanced && (
                            <div className="mt-3 space-y-3 p-3 bg-surface/30 rounded-xl border border-white/5 text-xs">
                                <div className="space-y-1">
                                    <label className="text-text-secondary">Negative Prompt:</label>
                                    <input
                                        type="text"
                                        value={negativePrompt}
                                        onChange={(e) => setNegativePrompt(e.target.value)}
                                        className="w-full bg-input text-text-primary rounded-lg p-2 text-xs border border-white/10"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-text-secondary block mb-1">Steps: {steps}</label>
                                        <input
                                            type="range"
                                            min="5"
                                            max="50"
                                            step="1"
                                            value={steps}
                                            onChange={(e) => setSteps(parseInt(e.target.value))}
                                            className="w-full accent-amber-400"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-text-secondary block mb-1">
                                            CFG: {cfgScale} {cfgScale >= 6.5 && cfgScale <= 9.0 ? '✨ (Optimal)' : cfgScale > 15 ? '🔥 (High)' : ''}
                                        </label>
                                        <input
                                            type="range"
                                            min="1"
                                            max="25"
                                            step="0.5"
                                            value={cfgScale}
                                            onChange={(e) => setCfgScale(parseFloat(e.target.value))}
                                            className="w-full accent-amber-400"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Error display */}
                    {error && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                            <span>⚠️</span>
                            <span className="flex-1">{error}</span>
                        </div>
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
                                {saveStatus && (
                                    <div className="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-emerald-600/90 text-white text-[11px] font-medium shadow-lg backdrop-blur-sm animate-in fade-in flex items-center gap-1.5">
                                        <span>✅</span> {saveStatus}
                                    </div>
                                )}
                            </div>

                            {/* Quick Actions for Result */}
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={handleSaveImage}
                                    disabled={isSaving}
                                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-text-primary transition-all flex items-center justify-center gap-1.5"
                                >
                                    <span>💾</span>
                                    <span>{isSaving ? 'Saving...' : 'Save Image'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleShareImage}
                                    disabled={isSharing}
                                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-text-primary transition-all flex items-center justify-center gap-1.5"
                                >
                                    <span>📤</span>
                                    <span>{isSharing ? 'Sharing...' : 'Share'}</span>
                                </button>
                            </div>
                        </div>
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
                            disabled={isGenerating || !prompt.trim()}
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
