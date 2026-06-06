import React, { useState, useEffect } from 'react';
import { SpeechConfig, ClusteringAlgorithm } from '../../../types';
import { triggerHaptic } from '../../../services/native';
import { TrashIcon } from '../../../constants';
import VoiceEnrollmentModal from '../../modals/VoiceEnrollmentModal';
import { logger } from '../../../services/logger';
import { FilePicker } from '@capawesome/capacitor-file-picker';

interface SpeakerSettingsProps {
    speechConfig: SpeechConfig;
    onSpeechConfigChange: (config: SpeechConfig) => void;
}

const SpeakerSettings: React.FC<SpeakerSettingsProps> = ({ speechConfig, onSpeechConfigChange }) => {
    const [isImportingOnnxSpeaker, setIsImportingOnnxSpeaker] = useState(false);
    const [isImportingVoskSpeaker, setIsImportingVoskSpeaker] = useState(false);
    const [showAdvancedDiarization, setShowAdvancedDiarization] = useState(false);
    const [speakerModelStatus, setSpeakerModelStatus] = useState<{
        onnxInstalled: boolean;
        voskSpeakerInstalled: boolean;
    }>({ onnxInstalled: false, voskSpeakerInstalled: false });

    const [isEnrollmentOpen, setIsEnrollmentOpen] = useState(false);
    const [hasVoiceProfile, setHasVoiceProfile] = useState(false);

    useEffect(() => {
        checkSpeakerModels();
    }, [isEnrollmentOpen]);

    const checkSpeakerModels = async () => {
        try {
            const { isOnnxSpeakerModelInstalled, isVoskSpeakerModelInstalled } = await import('../../../services/speaker/speakerModelDownloader');
            const [onnxInstalled, voskSpeakerInstalled] = await Promise.all([
                isOnnxSpeakerModelInstalled(),
                isVoskSpeakerModelInstalled()
            ]);
            setSpeakerModelStatus({ onnxInstalled, voskSpeakerInstalled });

            const profile = localStorage.getItem('user-voice-profile-onnx');
            setHasVoiceProfile(!!profile);
        } catch (e) {
            console.error('Failed to check speaker model status:', e);
        }
    };

    const handleSpeechConfigChange = (key: keyof SpeechConfig, value: any) => {
        onSpeechConfigChange({ ...speechConfig, [key]: value });
    };

    const handleImportOnnxSpeakerModel = async () => {
        triggerHaptic();
        try {
            const result = await FilePicker.pickFiles({
                types: ['application/octet-stream'],
                readData: false,
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                const fileName = file.name;

                if (!fileName.endsWith('.onnx')) {
                    alert('Please select a .onnx file');
                    return;
                }

                setIsImportingOnnxSpeaker(true);
                try {
                    const { importOnnxSpeakerModel } = await import('../../../services/speaker/speakerModelDownloader');
                    await importOnnxSpeakerModel(file.path!);
                    setSpeakerModelStatus(prev => ({ ...prev, onnxInstalled: true }));
                    alert(`Successfully imported: ${fileName}`);
                } finally {
                    setIsImportingOnnxSpeaker(false);
                }
            }
        } catch (e) {
            setIsImportingOnnxSpeaker(false);
            logger.log('error', 'Failed to import ONNX speaker model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    const handleImportVoskSpeakerModel = async () => {
        triggerHaptic();
        try {
            const result = await FilePicker.pickFiles({
                types: ['application/zip'],
                readData: false,
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                const fileName = file.name;

                if (!fileName.endsWith('.zip')) {
                    alert('Please select a .zip file');
                    return;
                }

                setIsImportingVoskSpeaker(true);
                try {
                    const { importVoskModel } = await import('../../../services/stt/voskModelDownloader');
                    await importVoskModel(file.path!, 'vosk-model-spk-0.4');
                    setSpeakerModelStatus(prev => ({ ...prev, voskSpeakerInstalled: true }));
                    alert(`Successfully imported: ${fileName}`);
                } finally {
                    setIsImportingVoskSpeaker(false);
                }
            }
        } catch (e) {
            setIsImportingVoskSpeaker(false);
            logger.log('error', 'Failed to import Vosk speaker model', e);
            alert('Failed to import model: ' + (e as any).message);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in p-6">
            <fieldset>
                <legend className="text-base font-medium text-text-primary mb-3">
                    👤 Speaker Identification
                </legend>
                <p className="text-sm text-text-secondary mb-4">
                    Configure speaker recognition for Meeting Mode and other assistant features.
                </p>

                {/* Diarization Settings */}
                <div className="bg-surface/30 rounded-lg p-4 mb-4 border border-white/5">
                    <h4 className="text-sm font-medium text-text-primary mb-3">⚙️ Diarization Configuration</h4>

                    {/* Mode Selection */}
                    <div className="mb-4">
                        <label className="text-xs font-medium text-text-primary mb-2 block">Diarization Mode</label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            {[
                                { id: 'fast', label: 'Fast (Vosk)', desc: 'Low latency, less precise' },
                                { id: 'precise', label: 'Precise (ONNX)', desc: 'High precision local' },
                                { id: 'hybrid', label: 'Hybrid', desc: 'Vosk + ONNX reprocessing' }
                            ].map((mode: any) => (
                                <div
                                    key={mode.id}
                                    onClick={() => { triggerHaptic(); handleSpeechConfigChange('diarizationMode', mode.id); }}
                                    className={`p-2 rounded border cursor-pointer transition-all ${speechConfig.diarizationMode === mode.id
                                        ? 'bg-primary/20 border-primary/50 text-primary'
                                        : 'bg-surface/50 border-white/5 hover:bg-surface/80 text-text-secondary'}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            checked={speechConfig.diarizationMode === mode.id}
                                            readOnly
                                            className="accent-primary"
                                        />
                                        <span className="text-sm font-medium">{mode.label}</span>
                                    </div>
                                    <p className="text-[10px] ml-5 opacity-80">{mode.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Clustering Algorithm */}
                    <div className="mb-4">
                        <label className="text-xs font-medium text-text-primary mb-1 block">Clustering Algorithm</label>
                        <select
                            value={speechConfig.clusteringAlgorithm || 'ahc'}
                            onChange={(e) => { triggerHaptic(); handleSpeechConfigChange('clusteringAlgorithm', e.target.value as ClusteringAlgorithm); }}
                            className="w-full bg-input border-surface rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="ahc">AHC (Agglomerative Hierarchical) - Balanced</option>
                            <option value="spectral">Spectral Clustering - More accurate for many speakers</option>
                            <option value="incremental">Incremental - Adaptive real-time</option>
                        </select>
                        <p className="text-[10px] text-text-secondary mt-1">Defines how audio segments are grouped to identify speakers.</p>
                    </div>

                    {/* Smoothing Algorithm */}
                    <div className="mb-4">
                        <label className="text-xs font-medium text-text-primary mb-1 block">Smoothing Algorithm</label>
                        <select
                            value={speechConfig.diarizationSmoothingAlgorithm || 'median'}
                            onChange={(e) => { triggerHaptic(); handleSpeechConfigChange('diarizationSmoothingAlgorithm', e.target.value); }}
                            className="w-full bg-input border-surface rounded-md px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="hmm">HMM Viterbi - Recommended for natural speech flow</option>
                            <option value="median">Median Filter - Basic sliding window</option>
                        </select>
                        <p className="text-[10px] text-text-secondary mt-1">Reduces rapid oscillations and errors in speaker identification.</p>
                    </div>

                    {/* Overlap Detection */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium text-text-primary">Overlap Detection</p>
                            <p className="text-[10px] text-text-secondary">Identifies when multiple people are speaking simultaneously</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={speechConfig.enableOverlapDetection ?? false}
                                onChange={(e) => { triggerHaptic(); handleSpeechConfigChange('enableOverlapDetection', e.target.checked); }}
                                className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-surface peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                        </label>
                    </div>
                </div>


                {/* Advanced Diarization Settings */}
                <div className="mb-4">
                    <button
                        onClick={() => { triggerHaptic(); setShowAdvancedDiarization(!showAdvancedDiarization); }}
                        className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors mb-3"
                    >
                        <span>{showAdvancedDiarization ? '▼' : '▶'}</span> Advanced Diarization Settings
                    </button>

                    {showAdvancedDiarization && (
                        <div className="space-y-4 pl-4 border-l-2 border-surface/50 animate-fade-in">
                            {/* Match Threshold */}
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Match Threshold</label>
                                    <span className="text-xs font-mono text-primary">{speechConfig.embeddingThreshold?.toFixed(2) || '0.80'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.50"
                                    max="0.95"
                                    step="0.01"
                                    value={speechConfig.embeddingThreshold || 0.80}
                                    onChange={(e) => handleSpeechConfigChange('embeddingThreshold', parseFloat(e.target.value))}
                                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">Higher = stricter matching (fewer false positives).</p>
                            </div>

                            {/* Rejection Threshold */}
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Rejection Threshold</label>
                                    <span className="text-xs font-mono text-primary">{speechConfig.embeddingRejectionThreshold?.toFixed(2) || '0.50'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.30"
                                    max="0.90"
                                    step="0.01"
                                    value={speechConfig.embeddingRejectionThreshold || 0.50}
                                    onChange={(e) => handleSpeechConfigChange('embeddingRejectionThreshold', parseFloat(e.target.value))}
                                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">Lower = creates new speakers more easily.</p>
                            </div>

                            {/* Adaptation Rate */}
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Adaptation Rate</label>
                                    <span className="text-xs font-mono text-primary">{speechConfig.embeddingAdaptationRate?.toFixed(2) || '0.03'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.0"
                                    max="0.20"
                                    step="0.01"
                                    value={speechConfig.embeddingAdaptationRate || 0.03}
                                    onChange={(e) => handleSpeechConfigChange('embeddingAdaptationRate', parseFloat(e.target.value))}
                                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">How quickly a speaker profile evolves.</p>
                            </div>

                            {/* Min Embedding Magnitude */}
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-xs text-text-secondary">Min Magnitude</label>
                                    <span className="text-xs font-mono text-primary">{speechConfig.minEmbeddingMagnitude?.toFixed(2) || '0.50'}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.0"
                                    max="1.5"
                                    step="0.05"
                                    value={speechConfig.minEmbeddingMagnitude || 0.50}
                                    onChange={(e) => handleSpeechConfigChange('minEmbeddingMagnitude', parseFloat(e.target.value))}
                                    className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">Minimum voice quality to accept.</p>
                            </div>
                        </div>
                    )}
                </div>


                {/* ONNX Speaker Embedding Model */}
                <div className="bg-surface/30 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-text-primary">
                            🧠 ONNX Diarization Model (High Precision)
                        </label>
                        {speakerModelStatus.onnxInstalled ? (
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                                    ✓ Installed
                                </span>
                                <button
                                    onClick={async () => {
                                        if (confirm('Delete ONNX model?')) {
                                            try {
                                                const { deleteOnnxSpeakerModel, isOnnxSpeakerModelInstalled, isVoskSpeakerModelInstalled } = await import('../../../services/speaker/speakerModelDownloader');
                                                await deleteOnnxSpeakerModel();

                                                setSpeakerModelStatus(prev => ({ ...prev, onnxInstalled: false }));

                                                const [onnx, vosk] = await Promise.all([
                                                    isOnnxSpeakerModelInstalled(),
                                                    isVoskSpeakerModelInstalled()
                                                ]);
                                                setSpeakerModelStatus(prev => ({ ...prev, onnxInstalled: onnx, voskSpeakerInstalled: vosk }));
                                            } catch (e) {
                                                console.error('Failed to delete ONNX model', e);
                                                alert('Error deleting model: ' + (e as any).message);
                                            }
                                        }
                                    }}
                                    className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                    title="Delete ONNX Model"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium">
                                Not installed
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-text-secondary mb-3">
                        Required for "Precise" mode in Meeting Mode and for User Voice Profile.
                    </p>

                    <button
                        onClick={handleImportOnnxSpeakerModel}
                        disabled={isImportingOnnxSpeaker}
                        className={`w-full py-3 px-4 rounded-lg text-text-primary font-medium transition-colors flex items-center justify-center gap-2 ${isImportingOnnxSpeaker ? 'bg-surface/50 cursor-not-allowed' : 'bg-primary/20 hover:bg-primary/30 border border-primary/50'}`}
                    >
                        {isImportingOnnxSpeaker ? 'Importing...' : 'Import ONNX Model (.onnx)'}
                    </button>

                    <div className="mt-3 p-3 bg-surface/20 rounded-lg">
                        <p className="text-xs text-text-secondary mb-2">
                            📥 <strong>Download (Wespeaker):</strong>
                        </p>
                        <div className="flex gap-2">
                            <a href="https://huggingface.co/Wespeaker/wespeaker-voxceleb-ecapa-tdnn512/resolve/main/voxceleb_ECAPA512.onnx?download=true" target="_blank" className="text-xs text-primary hover:underline">ECAPA-512</a>
                            <span className="text-text-secondary">|</span>
                            <a href="https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx?download=true" target="_blank" className="text-xs text-primary hover:underline">ResNet34</a>
                        </div>
                    </div>
                </div>

                {/* Vosk Speaker Model */}
                <div className="bg-surface/30 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-text-primary">
                            🎙️ Vosk Diarization Model (Fast)
                        </label>
                        {speakerModelStatus.voskSpeakerInstalled ? (
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                                    ✓ Installed
                                </span>
                                <button
                                    onClick={async () => {
                                        if (confirm('Delete Vosk Speaker model?')) {
                                            try {
                                                const { isOnnxSpeakerModelInstalled, isVoskSpeakerModelInstalled } = await import('../../../services/speaker/speakerModelDownloader');
                                                const { deleteVoskModel } = await import('../../../services/stt/voskModelDownloader');

                                                await deleteVoskModel('vosk-model-spk-0.4');

                                                setSpeakerModelStatus(prev => ({ ...prev, voskSpeakerInstalled: false }));

                                                const [onnx, vosk] = await Promise.all([
                                                    isOnnxSpeakerModelInstalled(),
                                                    isVoskSpeakerModelInstalled()
                                                ]);
                                                setSpeakerModelStatus(prev => ({ ...prev, onnxInstalled: onnx, voskSpeakerInstalled: vosk }));
                                            } catch (e) {
                                                console.error('Failed to delete Vosk Speaker model', e);
                                                alert('Error deleting model: ' + (e as any).message);
                                            }
                                        }
                                    }}
                                    className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                    title="Delete Vosk Speaker Model"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium">
                                Non installato
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-text-secondary mb-3">
                        Required for "Fast" mode in Meeting Mode. Less precise than ONNX.
                    </p>
                    <button
                        onClick={handleImportVoskSpeakerModel}
                        disabled={isImportingVoskSpeaker}
                        className={`w-full py-3 px-4 rounded-lg text-text-primary font-medium transition-colors flex items-center justify-center gap-2 ${isImportingVoskSpeaker ? 'bg-surface/50 cursor-not-allowed' : 'bg-primary/20 hover:bg-primary/30 border border-primary/50'}`}
                    >
                        {isImportingVoskSpeaker ? 'Importing...' : 'Import Vosk Model (.zip)'}
                    </button>
                    <div className="mt-2 text-center">
                        <a href="https://alphacephei.com/vosk/models/vosk-model-spk-0.4.zip" target="_blank" className="text-xs text-primary hover:underline">Download Vosk Speaker Model</a>
                    </div>
                </div>

                {/* User Voice Profile Enrollment */}
                <div className="bg-surface/30 rounded-lg p-4 mb-4 border border-primary/20">
                    <div className="flex items-center justify-between mb-3">
                        <label className="block text-sm font-medium text-text-primary flex items-center gap-2">
                            👤 User Voice Profile
                            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase tracking-wide">
                                Beta
                            </span>
                        </label>
                    </div>
                    <p className="text-xs text-text-secondary mb-3">
                        Record your voice to allow the assistant to identify you as "You" in meetings.
                        Requires ONNX model installed.
                    </p>

                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs text-text-secondary">Status:</span>
                        {hasVoiceProfile ? (
                            <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">✓ Profile Active</span>
                        ) : (
                            <span className="text-xs font-bold text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">⚠ No Profile</span>
                        )}
                    </div>

                    <button
                        onClick={() => setIsEnrollmentOpen(true)}
                        className={`w-full py-2 px-4 rounded-lg bg-surface hover:bg-white/5 border border-white/10 text-sm font-medium transition-colors group ${hasVoiceProfile ? 'text-green-400 border-green-500/30' : 'text-text-secondary'}`}
                    >
                        <span className="flex items-center justify-center gap-2 group-hover:text-primary transition-colors">
                            🎙️ {hasVoiceProfile ? 'Update Voice Profile' : 'Record Voice Profile'}
                        </span>
                    </button>

                    <VoiceEnrollmentModal
                        isOpen={isEnrollmentOpen}
                        onClose={() => setIsEnrollmentOpen(false)}
                        onnxInstalled={speakerModelStatus.onnxInstalled}
                    />
                </div>
            </fieldset >
        </div >
    );
};


export default SpeakerSettings;
