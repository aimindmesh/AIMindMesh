import React, { useState, useEffect, useRef } from 'react';
import { getWakeWordService } from '../../../services/wakeword';
import { logger } from '../../../services/logger';
import { HighQualityAudioRecorder } from '../../../services/audio/highQualityAudioRecorder';
import { getVADService } from '../../../services/stt/vadService';

interface CustomWakeWordWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (name: string) => void;
}

type Step = 'INTRO' | 'NAME' | 'RECORD_1' | 'RECORD_2' | 'RECORD_3' | 'FINISH';

// Sample data structure
interface RecordedSample {
    pcmData: Int16Array;
    base64: string;
    isValid: boolean; // Passed VAD/RMS checks
}

export const CustomWakeWordWizard: React.FC<CustomWakeWordWizardProps> = ({
    isOpen,
    onClose,
    onSuccess
}) => {
    const [step, setStep] = useState<Step>('INTRO');
    const [name, setName] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [samples, setSamples] = useState<RecordedSample[]>([]);
    const recorderRef = useRef<HighQualityAudioRecorder | null>(null);
    const pcmBufferRef = useRef<Int16Array[]>([]);

    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setStep('INTRO');
            setName('');
            setIsRecording(false);
            setError(null);
            setIsSaving(false);
            setSamples([]);
            pcmBufferRef.current = [];
            // Clear previous training data and start training session
            const service = getWakeWordService();
            service.clearTrainingData()
                .then(() => service.startTraining())
                .catch(e => {
                    logger.log('error', 'Failed to start training session', e);
                    setError('Failed to initialize training. Please restart the app.');
                });
        }
        return () => {
            // Cleanup recorder
            if (recorderRef.current) {
                recorderRef.current.stop().catch(() => { });
                recorderRef.current.cleanup().catch(() => { });
                recorderRef.current = null;
            }
            // Stop training session
            getWakeWordService().stopTraining().catch(() => { });
        };
    }, [isOpen]);

    // Helper to convert Int16Array to Base64
    const int16ToBase64 = (data: Int16Array): string => {
        const bytes = new Uint8Array(data.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    const handleStartRecording = async () => {
        try {
            setError(null);
            pcmBufferRef.current = [];

            // Initialize recorder if needed
            if (!recorderRef.current) {
                recorderRef.current = new HighQualityAudioRecorder({
                    sampleRate: 16000,
                    channels: 1,
                    noiseSuppression: false, // Raw audio for training
                    autoGainControl: false,
                    echoCancellation: false,
                });
                await recorderRef.current.init();
            }

            // Start recording with level callback
            await recorderRef.current.start(
                () => { }, // Level callback - not used for wake word training
                undefined,
                (chunk: Int16Array) => {
                    // Collect PCM chunks during recording
                    pcmBufferRef.current.push(chunk.slice());
                }
            );

            setIsRecording(true);
        } catch (e) {
            setError('Failed to start recording');
            logger.log('error', 'Training recording start failed', e);
        }
    };

    const handleStopRecording = async (nextStep?: Step) => {
        if (!isRecording || !recorderRef.current) return;

        try {
            await recorderRef.current.stop();
            setIsRecording(false);

            // Combine all chunks into a single buffer
            const totalLength = pcmBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
            const fullPcm = new Int16Array(totalLength);
            let offset = 0;
            for (const chunk of pcmBufferRef.current) {
                fullPcm.set(chunk, offset);
                offset += chunk.length;
            }

            // Basic RMS check to ensure user spoke
            let sumSquares = 0;
            for (let i = 0; i < fullPcm.length; i++) {
                const normalized = fullPcm[i] / 32768.0;
                sumSquares += normalized * normalized;
            }
            const rms = Math.sqrt(sumSquares / fullPcm.length);
            const minRms = 0.02; // Threshold for "user spoke"

            if (rms < minRms) {
                setError('Recording was too quiet. Please speak louder.');
                return; // Don't advance, let them re-record
            }

            // Check with VAD if available
            let isValid = true;
            const vadService = getVADService();
            if (vadService.isAvailable()) {
                logger.log('info', 'Verifying recording with VAD...');
                try {
                    const base64 = int16ToBase64(fullPcm);
                    const vadResult = await vadService.processSamples(base64);
                    logger.log('info', `VAD Result: Speech=${vadResult.isSpeech}, Conf=${vadResult.confidence}`);

                    isValid = vadResult.isSpeech && vadResult.confidence > 0.6;
                    if (!isValid) {
                        setError('No clear speech detected. Please try again.');
                        return;
                    }
                } catch (vadError) {
                    // VAD failed, proceed with RMS-only validation
                    logger.log('warn', 'VAD check failed, using RMS only', vadError);
                }
            } else {
                logger.log('warn', 'VAD service not available, skipping VAD check');
            }

            // Save sample
            const base64 = int16ToBase64(fullPcm);
            setSamples(prev => [...prev, { pcmData: fullPcm, base64, isValid }]);
            setError(null);

            if (nextStep) {
                setStep(nextStep);
            }
        } catch (e) {
            setError('Failed to stop recording');
            logger.log('error', 'Training recording stop failed', e);
        }
    };

    const playLastRecording = () => {
        const lastSample = samples[samples.length - 1];
        if (!lastSample) return;

        playPcm16FromInt16(lastSample.pcmData);
    };

    const playPcm16FromInt16 = (pcmData: Int16Array) => {
        try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = audioCtx.createBuffer(1, pcmData.length, 16000);
            const channelData = audioBuffer.getChannelData(0);

            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = pcmData[i] / 32768.0;
            }

            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);
            source.start();
        } catch (e) {
            logger.log('error', 'Failed to play audio', e);
        }
    };

    const handleSave = async () => {
        if (!name || samples.length < 3) {
            setError('Please complete all 3 recordings before saving.');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const wakeWordService = getWakeWordService();

            // Send each sample to native for embedding processing
            let successCount = 0;
            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];
                // Debug log to check data integrity
                console.log(`[CustomWakeWord] Sample ${i + 1} Base64 Preview:`, sample.base64.substring(0, 100));

                const success = await wakeWordService.provideTrainingSample(sample.base64);
                if (success) {
                    successCount++;
                    logger.log('info', `Sample ${i + 1} ingested successfully`);
                } else {
                    logger.log('warn', `Sample ${i + 1} failed to ingest`);
                }
            }

            if (successCount < 2) {
                const errorMsg = `Only ${successCount}/3 samples were valid. Please redo recording.`;
                setError(errorMsg);
                // Return immediately to prevent saving or navigation
                return;
            }

            // Save the profile
            await wakeWordService.saveProfile(name);
            logger.log('info', `Custom wake word "${name}" saved with ${successCount} samples`);

            onSuccess(name);
            onClose();
        } catch (e) {
            setError('Failed to save profile');
            logger.log('error', 'Save profile failed', e);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-surface border border-gray-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-900/50">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span>🎙️</span> Train Custom Wake Word
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
                        ✖
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {step === 'INTRO' && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto text-blue-400 text-3xl">
                                🎤
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-xl font-medium text-white">Create Your Own Wake Word</h4>
                                <p className="text-sm text-gray-400">
                                    You can train the assistant to respond to any phrase, like "Hey Computer" or "Open Sesame".
                                </p>
                                <p className="text-xs text-gray-500 mt-4">
                                    You will need to record the phrase 3 times in a quiet environment.
                                </p>
                            </div>
                            <button
                                onClick={() => setStep('NAME')}
                                className="w-full py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark transition-colors flex items-center justify-center gap-2"
                            >
                                Get Started ▶
                            </button>
                        </div>
                    )}

                    {step === 'NAME' && (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-300">Wake Word Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9 ]/g, ''))}
                                    placeholder="e.g., Hey Computer"
                                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                                    autoFocus
                                />
                                <p className="text-xs text-gray-500">
                                    Use letters and spaces only. Keep it short (2-4 syllables).
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStep('INTRO')}
                                    className="flex-1 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={() => name.length > 2 && setStep('RECORD_1')}
                                    disabled={name.length <= 2}
                                    className="flex-1 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}

                    {(step === 'RECORD_1' || step === 'RECORD_2' || step === 'RECORD_3') && (
                        <div className="text-center space-y-8">
                            <div>
                                <h4 className="text-lg font-medium text-white mb-2">
                                    Recording {step === 'RECORD_1' ? '1' : step === 'RECORD_2' ? '2' : '3'} of 3
                                </h4>
                                <p className="text-sm text-gray-400">
                                    Press and hold the button, say <strong className="text-white">"{name}"</strong> clearly, then release.
                                </p>
                            </div>

                            <div className="relative h-32 flex items-center justify-center">
                                {/* Recording Indicator Ring */}
                                {isRecording && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-32 h-32 bg-red-500/20 rounded-full animate-ping"></div>
                                        <div className="w-24 h-24 bg-red-500/30 rounded-full animate-pulse absolute"></div>
                                    </div>
                                )}

                                <button
                                    onPointerDown={(e) => {
                                        e.preventDefault(); // Prevent text selection
                                        handleStartRecording();
                                    }}
                                    onPointerUp={(e) => {
                                        e.preventDefault();
                                        handleStopRecording(
                                            step === 'RECORD_1' ? 'RECORD_2' :
                                                step === 'RECORD_2' ? 'RECORD_3' : 'FINISH'
                                        );
                                    }}
                                    onPointerLeave={() => {
                                        if (isRecording) {
                                            handleStopRecording();
                                            // Don't advance if they dragged off, maybe? 
                                            // Let's assume drag off = cancel/abort this sample?
                                            // For simplicity, we just stop and don't advance step if cancelled weirdly, 
                                            // but handleStopRecording logic above advances. 
                                            // Let's keep it simple: Release advances.
                                        }
                                    }}
                                    className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all transform active:scale-95 ${isRecording
                                        ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                                        : 'bg-gray-700 hover:bg-gray-600 border-4 border-gray-800'
                                        }`}
                                >
                                    <span className="text-3xl">🎤</span>
                                </button>
                            </div>

                            <p className="text-xs text-gray-500">
                                {isRecording ? 'Recording... Release when done' : 'Press and hold to record'}
                            </p>
                        </div>
                    )}

                    {/* Replay option between steps if not recording */}
                    {!isRecording && samples.length > 0 && step !== 'FINISH' && step !== 'INTRO' && step !== 'NAME' && (
                        <div className="text-center mt-6">
                            <button
                                onClick={playLastRecording}
                                className="text-blue-400 text-sm hover:text-blue-300 flex items-center justify-center gap-2 mx-auto px-4 py-2 hover:bg-blue-500/10 rounded-full transition-colors"
                            >
                                <span>🔊</span> Listen to recording
                            </button>
                        </div>
                    )}



                    {step === 'FINISH' && (
                        <div className="text-center space-y-6">
                            {!error && (
                                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto text-green-400 text-3xl">
                                    ✓
                                </div>
                            )}
                            <div className="space-y-2">
                                <h4 className="text-xl font-medium text-white">
                                    {error ? 'Validation Failed' : 'Recordings Complete'}
                                </h4>
                                <p className="text-sm text-gray-400">
                                    {error
                                        ? 'Some recordings were not accepted. Please check the error below.'
                                        : `You've recorded 3 samples for "${name}". Ready to create?`
                                    }
                                </p>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                                    {error}
                                </div>
                            )}

                            <div className="flex gap-3 pt-4">
                                <button
                                    onClick={() => setStep('RECORD_1')}
                                    className="flex-1 py-3 bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
                                >
                                    ↺ Redo
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex-1 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isSaving ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <span>💾</span>}
                                    Create Wake Word
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
