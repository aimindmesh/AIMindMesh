import React, { useState, useRef, useEffect } from 'react';
import { MicrophoneIcon, CloseIcon } from '../../constants';
// import { SpeakerEmbedding } from 'speaker-embedding-capacitor'; // Temporarily removed or mock if needed? No, user has this.
import { SpeakerEmbedding } from 'speaker-embedding-capacitor';
import { logger } from '../../services/logger';
import { HighQualityAudioRecorder, pcmToBase64 } from '../../services/audio/highQualityAudioRecorder';

interface VoiceEnrollmentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onnxInstalled: boolean;
}

const VoiceEnrollmentModal: React.FC<VoiceEnrollmentModalProps> = ({ isOpen, onClose, onnxInstalled }) => {
    const [step, setStep] = useState<'intro' | 'recording' | 'processing' | 'success' | 'error'>('intro');
    const [timeLeft, setTimeLeft] = useState(5);
    const [errorMessage, setErrorMessage] = useState('');
    const recorderRef = useRef<HighQualityAudioRecorder | null>(null);
    const timerRef = useRef<number | null>(null);

    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setStep('intro');
            setErrorMessage('');
            setTimeLeft(5);
        } else {
            stopRecording();
        }
    }, [isOpen]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (recorderRef.current) {
                recorderRef.current.cleanup();
            }
        };
    }, []);

    const startRecording = async () => {
        if (!onnxInstalled) {
            setErrorMessage("The ONNX model is required to create a precise voice profile.");
            setStep('error');
            return;
        }

        try {
            // Ensure ONNX model is loaded
            try {
                const status = await SpeakerEmbedding.isModelLoaded();
                if (!status.loaded) {
                    logger.log('info', 'VoiceEnrollment: Loading ONNX model...');
                    await SpeakerEmbedding.loadModel({ modelPath: 'models/ecapa_tdnn.onnx' });
                }
            } catch (e) {
                logger.log('error', 'VoiceEnrollment: Failed to load model', e);
                setErrorMessage("AI model loading error.");
                setStep('error');
                return;
            }

            // Initialize HighQualityAudioRecorder
            const recorder = new HighQualityAudioRecorder({
                sampleRate: 16000,  // ONNX expects 16kHz
                channels: 1,        // Mono
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            });

            await recorder.init();
            recorderRef.current = recorder;

            // Start recording
            recorder.start();

            setStep('recording');
            setTimeLeft(5);

            // Countdown
            timerRef.current = window.setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        stopRecording();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

        } catch (error) {
            logger.log('error', 'Failed to start enrollment recording', error);
            setErrorMessage("Unable to access microphone.");
            setStep('error');
        }
    };

    const stopRecording = async () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (recorderRef.current && recorderRef.current.isCurrentlyRecording()) {
            try {
                const result = await recorderRef.current.stop();
                await processAudio(result.pcmData);
            } catch (e) {
                logger.log('error', 'Error stopping recording', e);
                setErrorMessage("Audio recording error.");
                setStep('error');
            }
        }

        // Cleanup recorder
        if (recorderRef.current) {
            await recorderRef.current.cleanup();
            recorderRef.current = null;
        }
    };

    const processAudio = async (pcmData: Int16Array) => {
        setStep('processing');
        try {
            // Convert PCM16 to Base64 (already at 16kHz mono - perfect for ONNX)
            const base64Audio = pcmToBase64(pcmData);

            const result = await SpeakerEmbedding.extractEmbedding({
                audioData: base64Audio
            });

            if (result && result.embedding && result.embedding.length > 0) {
                // Save profile
                localStorage.setItem('user-voice-profile-onnx', JSON.stringify(result.embedding));
                logger.log('info', 'User voice profile saved');
                setStep('success');

                // Wait a bit then close
                setTimeout(() => {
                    onClose();
                }, 2000);
            } else {
                throw new Error("No embedding extracted.");
            }
        } catch (pluginError) {
            logger.log('error', 'Embedding extraction failed', pluginError);
            setErrorMessage("Error analyzing voice. Try again speaking clearly.");
            setStep('error');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface border border-white/10 rounded-xl max-w-md w-full p-6 shadow-2xl animate-fade-in-up">

                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        {step === 'success' ? '✅ Profile Saved' : '👤 Voice Profile'}
                    </h3>
                    <button onClick={onClose} className="text-text-secondary hover:text-white">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                {/* Content based on step */}
                <div className="text-center py-4">

                    {step === 'intro' && (
                        <>
                            <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-primary">
                                <MicrophoneIcon className="w-8 h-8" />
                            </div>
                            <p className="text-text-secondary mb-6">
                                You will read a short phrase for 5 seconds. Make sure you are in a quiet environment.
                            </p>
                            <div className="bg-surface/50 p-4 rounded-lg mb-6 border border-white/10">
                                <p className="text-white font-medium italic">
                                    "Hi, it's me. This is my voice for identification in meetings."
                                </p>
                            </div>
                            <button
                                onClick={startRecording}
                                disabled={!onnxInstalled}
                                className={`w-full py-3 rounded-lg font-bold transition-all ${onnxInstalled
                                    ? 'bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20'
                                    : 'bg-surface border border-white/10 text-text-secondary cursor-not-allowed'}`}
                            >
                                {onnxInstalled ? 'Start Recording' : 'Requires ONNX Model'}
                            </button>
                        </>
                    )}

                    {step === 'recording' && (
                        <>
                            <div className="relative w-24 h-24 mx-auto mb-6 flex items-center justify-center">
                                <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-20"></div>
                                <div className="relative bg-surface border-4 border-red-500 rounded-full w-20 h-20 flex items-center justify-center">
                                    <span className="text-3xl font-bold text-white">{timeLeft}</span>
                                </div>
                            </div>
                            <p className="text-white font-medium mb-2">Speak now...</p>
                            <p className="text-text-secondary text-sm">
                                "Hi, it's me. This is my voice..."
                            </p>
                        </>
                    )}

                    {step === 'processing' && (
                        <>
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-6"></div>
                            <p className="text-white font-medium">Analysis in progress...</p>
                            <p className="text-text-secondary text-sm mt-2">Creating voice fingerprint...</p>
                        </>
                    )}

                    {step === 'success' && (
                        <>
                            <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <p className="text-white font-medium">Profile saved successfully!</p>
                        </>
                    )}

                    {step === 'error' && (
                        <>
                            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </div>
                            <p className="text-red-400 font-medium mb-4">{errorMessage}</p>
                            <button
                                onClick={() => setStep('intro')}
                                className="px-6 py-2 bg-surface hover:bg-white/10 border border-white/10 rounded-lg text-white transition-colors"
                            >
                                Try Again
                            </button>
                        </>
                    )}

                </div>
            </div>
        </div>
    );
};

export default VoiceEnrollmentModal;
