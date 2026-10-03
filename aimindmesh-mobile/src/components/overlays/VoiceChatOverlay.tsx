import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Personality, SpeechConfig } from '../../types';
import { useGeminiLive } from '../../hooks/useGeminiLive';
import { PhoneIcon, SpeakerIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';
import { getOfflineSttService, getOnlineSttService, stopSpeaking } from '../../services/tts/speech';
import { getVoskSttService } from '../../services/stt/voskSTT';
import { getVoxtralSttService } from '../../services/stt/voxtralSTT';
import { getWhisperSTTService } from '../../services/stt/whisperSTT';
import { logger } from '../../services/logger';
import { AudioOutput } from 'audio-output-capacitor';
import { Capacitor } from '@capacitor/core';
import { normalizeSttProvider, normalizeTtsProvider, shouldUseStandardVoiceChat } from '../../services/tts/providerIds';
import { enterActivity, leaveActivity } from '../../services/model/modelOrchestrator';
import { voiceCallMemoryConflict } from '../../services/model/llmPreloader';

interface VoiceChatOverlayProps {
    personality: Personality;
    apiKey: string;
    onClose: () => void;
    sendMessage?: (text: string, options?: { hidden?: boolean, role?: 'user' | 'system' }) => Promise<void>;
    isSpeaking?: boolean;
    isLoading?: boolean;
    currentThinking?: string;
    speechConfig?: SpeechConfig;
    autoStartConversation?: boolean;
    /**
     * Gemini Live answers by voice itself: its turns are stored through this instead of
     * sendMessage(), which would make the main provider generate a second answer.
     */
    onSaveTranscript?: (role: 'user' | 'model', text: string) => void;
}

const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: "Idle", color: "text-gray-400" },
    1: { text: "Connecting...", color: "text-yellow-400" },
    2: { text: "Connected", color: "text-green-400" },
    3: { text: "Disconnected", color: "text-gray-400" },
    4: { text: "Error", color: "text-red-400" },
};

const StandardVoiceChat: React.FC<VoiceChatOverlayProps> = ({
    personality, apiKey, onClose, sendMessage, isSpeaking, isLoading, currentThinking, speechConfig, autoStartConversation
}) => {
    const [transcript, setTranscript] = useState('');
    const [status, setStatus] = useState('Initializing...');
    const [audioLevel, setAudioLevel] = useState(0);
    const [isSttReady, setIsSttReady] = useState(false); // Renamed from isVoskReady
    // const [error, setError] = useState<string | null>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const lastTranscriptRef = useRef('');
    const hasStartedRef = useRef(false);
    // Only accept transcript updates while listening: services can deliver a late result
    // after stop() (or a start that raced a stop), which would send a phantom message.
    const listeningRef = useRef(false);
    // Lowercased/legacy-normalized ids ('Vosk' from the one-click setup used to match nothing)
    const sttProvider = normalizeSttProvider(speechConfig?.sttProvider);
    const ttsProvider = normalizeTtsProvider(speechConfig?.ttsProvider);

    // Initial Greeting for Autonomous Calls
    useEffect(() => {
        if (autoStartConversation &&
            isSttReady &&
            !isLoading &&
            !isSpeaking &&
            !hasStartedRef.current &&
            sendMessage) {

            hasStartedRef.current = true;
            logger.log('info', '[VoiceChat] Triggering autonomous greeting');

            // Send a hidden system prompt to the LLM to make it speak first
            sendMessage(
                "(System: The user just answered your autonomous call. Immediately greet them warmly and explain exactly why you called. Be concise.)",
                { role: 'system', hidden: true }
            );
        }
    }, [autoStartConversation, isSttReady, isLoading, isSpeaking, sendMessage]);

    const sttService = sttProvider === 'voxtral'
        ? getVoxtralSttService()
        : sttProvider === 'whisper'
            ? getWhisperSTTService()
            : sttProvider === 'vosk'
                ? getVoskSttService()
                : sttProvider === 'offline'
                    ? getOfflineSttService()
                    : getOnlineSttService();

    const handleTranscriptUpdate = useCallback((text: string) => {
        if (!listeningRef.current) return;
        setTranscript(text);
        lastTranscriptRef.current = text;

        // Reset silence timer on new input
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        if (text.trim()) {
            silenceTimerRef.current = setTimeout(() => {
                if (lastTranscriptRef.current.trim()) {
                    sendMessage?.(lastTranscriptRef.current);
                    setTranscript('');
                    lastTranscriptRef.current = '';
                }
            }, 2000); // 2 seconds silence to send
        }
    }, [sendMessage]);

    // RAM during a call: speech models + LLM, no Stable Diffusion; hanging up frees the speech models
    useEffect(() => {
        void enterActivity('voice', ['gguf', 'litert', 'genie', 'whisper', 'voxtral']).catch(() => { });
        return () => { void leaveActivity('voice'); };
    }, []);

    // Load STT model if needed (Vosk, Voxtral, or Whisper)
    useEffect(() => {
        const checkAndLoadModel = async () => {
            if (sttProvider === 'vosk' && speechConfig?.voskModelId) {
                const voskService = getVoskSttService();
                if (!voskService.isModelLoaded() || voskService.getCurrentModelId() !== speechConfig.voskModelId) {
                    setStatus('Loading Vosk model...');
                    setIsSttReady(false);
                    try {
                        await voskService.loadModel(speechConfig.voskModelId);
                        setIsSttReady(true);
                        setStatus('Ready');
                    } catch (err) {
                        logger.log('error', 'Failed to load Vosk model:', err);
                        setStatus('Error: Failed to load model');
                        setIsSttReady(false);
                    }
                } else {
                    setIsSttReady(true);
                }
            } else if (sttProvider === 'whisper') {
                const whisperService = getWhisperSTTService();
                let modelToLoad = speechConfig?.whisperModelId;

                if (!modelToLoad) {
                    try {
                        const { listLocalWhisperModels } = await import('../../services/stt/whisperModelDownloader');
                        const models = await listLocalWhisperModels();
                        if (models.length > 0) {
                            modelToLoad = models[0];
                            logger.log('info', `VoiceChatOverlay: Auto-selecting Whisper model: ${modelToLoad}`);
                        }
                    } catch (e) {
                        logger.log('error', 'VoiceChatOverlay: Failed to discover Whisper models', e);
                    }
                }

                if (!modelToLoad) {
                    setStatus('Error: No Whisper models installed. Check Settings.');
                    setIsSttReady(false);
                    return;
                }
                const conflict = voiceCallMemoryConflict('whisper', modelToLoad);
                if (conflict) { setStatus(`Error: ${conflict}`); setIsSttReady(false); return; }

                if (!whisperService.isModelLoaded() || whisperService.getCurrentModelId() !== modelToLoad) {
                    setStatus('Loading Whisper...');
                    setIsSttReady(false);
                    try {
                        await whisperService.loadModel(modelToLoad);
                        setIsSttReady(true);
                        setStatus('Ready');
                    } catch (err) {
                        logger.log('error', 'Failed to load Whisper model:', err);
                        setStatus('Error: Failed to load model');
                        setIsSttReady(false);
                    }
                } else {
                    setIsSttReady(true);
                }
            } else if (sttProvider === 'voxtral') {
                const conflict = voiceCallMemoryConflict('voxtral');
                if (conflict) { setStatus(`Error: ${conflict}`); setIsSttReady(false); return; }
                const voxtralService = getVoxtralSttService();
                let modelToLoad = speechConfig?.voxtralModel;

                // Fallback discovery if needed
                if (!modelToLoad) {
                    try {
                        const { listLocalVoxtralModels } = await import('../../services/stt/voxtralModelDownloader');
                        const models = await listLocalVoxtralModels();
                        if (models.length > 0) {
                            modelToLoad = models[0];
                            logger.log('info', `VoiceChatOverlay: Auto-selecting fallback model: ${modelToLoad}`);
                        }
                    } catch (e) {
                        logger.log('error', 'VoiceChatOverlay: Failed to find models', e);
                    }
                }

                if (!modelToLoad) {
                    setStatus('Error: No models found. Check Settings.');
                    setIsSttReady(false);
                    return;
                }

                // Voxtral service might have loaded via useModelLoader, but we check here
                if (!voxtralService.checkModelLoaded() || voxtralService.getCurrentModelPath() !== modelToLoad) {
                    setStatus('Loading Voxtral...');
                    setIsSttReady(false);
                    try {
                        await voxtralService.loadModel({
                            modelPath: modelToLoad,
                            transcriptionDelayMs: speechConfig?.voxtralLatency,
                            nThreads: speechConfig?.voxtralThreads,
                            maxModelLen: speechConfig?.voxtralMaxLen
                        });
                        setIsSttReady(true);
                        setStatus('Ready');
                    } catch (err) {
                        logger.log('error', 'Failed to load Voxtral model:', err);
                        setStatus('Error: Failed to load model');
                        setIsSttReady(false);
                    }
                } else {
                    setIsSttReady(true);
                }
            } else {
                // For offline/online STT, mark as ready immediately
                setIsSttReady(true);
            }
        };

        checkAndLoadModel();
    }, [sttProvider, speechConfig?.voskModelId, speechConfig?.whisperModelId, speechConfig?.voxtralModel, speechConfig?.voxtralLatency, speechConfig?.voxtralThreads]);

    // Throttle audio level updates to reduce render pressure (10fps)
    const throttledSetAudioLevel = useCallback((level: number) => {
        // Basic throttle implementation since we might not have lodash
        const now = Date.now();
        if (now - (sttService as any)._lastLevelUpdate > 100 || Math.abs(level - (sttService as any)._lastLevel) > 0.1) {
            setAudioLevel(level);
            (sttService as any)._lastLevelUpdate = now;
            (sttService as any)._lastLevel = level;
        }
    }, [sttService]);

    useEffect(() => {
        // Initialize throttle trackers on service
        (sttService as any)._lastLevelUpdate = 0;
        (sttService as any)._lastLevel = 0;
    }, [sttService]);

    useEffect(() => {
        if (isLoading) {
            setStatus('Thinking...');
            listeningRef.current = false;
            sttService.stop();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            // CRITICAL: Clear transcript when AI starts thinking to prevent contamination
            setTranscript('');
            lastTranscriptRef.current = '';
            // Note: Piper idle timer (in piperTTS.ts) handles memory cleanup after speech ends
        } else if (isSpeaking) {
            setStatus('Speaking...');
            listeningRef.current = false;
            sttService.stop();
            // CRITICAL: Clear transcript when AI starts speaking
            setTranscript('');
            lastTranscriptRef.current = '';
        } else {
            // Only start listening if STT is ready
            if (!isSttReady) {
                if (sttProvider === 'vosk' || sttProvider === 'voxtral' || sttProvider === 'whisper') {
                    setStatus('Loading model...');
                    return;
                }
            }

            const supportCheck = (sttService as { isSupported?: () => boolean }).isSupported;
            if (supportCheck && !supportCheck.call(sttService)) {
                setStatus('Error: speech recognition not supported on this device');
                return;
            }

            // Initial state before listening
            setStatus('Connecting...');

            // Delay to prevent picking up TTS echo
            const timer = setTimeout(() => {
                listeningRef.current = true;
                setStatus('Listening');
                // Start failures (no microphone permission, model missing...) must not leave
                // the call on "Listening" with nothing recording
                Promise.resolve(sttService.start(handleTranscriptUpdate, apiKey, throttledSetAudioLevel))
                    .catch((err: unknown) => {
                        logger.log('error', 'Failed to start speech recognition', err);
                        listeningRef.current = false;
                        const message = err instanceof Error ? err.message : 'microphone unavailable';
                        setStatus(`Error: ${message}`);
                    });
            }, 1000);

            return () => {
                clearTimeout(timer);
                listeningRef.current = false;
                sttService.stop();
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            };
        }

        return () => {
            listeningRef.current = false;
            sttService.stop();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
    }, [isLoading, isSpeaking, isSttReady, sttProvider, sttService, handleTranscriptUpdate, apiKey, throttledSetAudioLevel]);

    const handleEndCall = () => {
        triggerHaptic('HEAVY');
        onClose();
    };

    const [audioOutput, setAudioOutput] = useState<'speaker' | 'earpiece'>(speechConfig?.defaultAudioOutput || 'earpiece');

    useEffect(() => {
        // Apply initial audio output setting on mount
        const initialOutput = speechConfig?.defaultAudioOutput || 'earpiece';
        const isSpeaker = initialOutput === 'speaker';

        logger.log('info', `Initializing audio output to ${initialOutput} (StandardVoiceChat)`);

        import('@capacitor/core').then(({ Capacitor }) => {
            if (Capacitor.isNativePlatform()) {
                AudioOutput.setSpeakerphoneOn({ enabled: isSpeaker })
                    .catch((err: any) => logger.log('error', 'Failed to set initial speakerphone', err));
            }
        });

        applyTtsOutput(ttsProvider, initialOutput);
    }, []);

    const toggleAudioOutput = () => {
        const next = audioOutput === 'speaker' ? 'earpiece' : 'speaker';
        setAudioOutput(next);
        const isSpeaker = next === 'speaker';

        logger.log('info', `Toggling audio output to ${next} (StandardVoiceChat)`);

        // Use native plugin on Capacitor platforms
        import('@capacitor/core').then(({ Capacitor }) => {
            if (Capacitor.isNativePlatform()) {
                AudioOutput.setSpeakerphoneOn({ enabled: isSpeaker })
                    .then(() => logger.log('info', `Native speakerphone set to ${isSpeaker ? 'ON' : 'OFF'}`))
                    .catch((err: any) => logger.log('error', 'Failed to set native speakerphone', err));
            }
        });

        // Keep TTS-specific calls for their internal state, but native plugin should handle routing
        applyTtsOutput(ttsProvider, next);
    };

    return (
        <div className="fixed inset-0 bg-gray-900/95 backdrop-blur-lg z-50 flex flex-col items-center justify-between p-8 pt-safe pb-safe text-center animate-fade-in">
            <div className="w-full max-w-4xl text-left">
                <h2 className={`text-lg font-medium ${status === 'Listening' ? 'text-green-400' :
                    status === 'Thinking...' ? 'text-blue-400' :
                        status === 'Speaking...' ? 'text-purple-400' : 'text-gray-400'
                    }`}>{status}</h2>
                {/* {error && <p className="text-sm text-red-500 mt-1">{error}</p>} */}
            </div>

            <div className="flex flex-col items-center">
                <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
                    <div
                        className={`absolute inset-0 bg-companion-primary rounded-full transition-all duration-75 ease-out ${status === 'Listening' ? 'opacity-30' : 'opacity-10'}`}
                        style={{ transform: status === 'Listening' ? `scale(${1 + audioLevel * 0.5})` : 'scale(1)' }}
                    />
                    <div
                        className={`absolute inset-4 bg-companion-primary rounded-full transition-all duration-100 ease-out ${status === 'Listening' ? 'opacity-20' : 'opacity-5'}`}
                        style={{ transform: status === 'Listening' ? `scale(${1 + audioLevel * 0.3})` : 'scale(1)' }}
                    />
                    <div className="w-32 h-32 md:w-40 md:h-40 bg-gradient-to-br from-companion-primary to-companion-secondary rounded-full flex items-center justify-center font-bold text-6xl shadow-2xl z-10 relative">
                        {personality.name.charAt(0)}
                    </div>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold mt-8">{personality.name}</h1>
            </div>

            <div className="w-full max-w-4xl h-32 flex flex-col justify-end">
                <div className="text-lg md:text-xl text-center transition-opacity overflow-y-auto max-h-32">
                    {isLoading && currentThinking ? (
                        <p className="text-blue-300 italic min-h-[2rem] whitespace-pre-wrap text-sm animate-pulse">{currentThinking}</p>
                    ) : (
                        <p className="text-gray-400 min-h-[2rem] whitespace-pre-wrap">{transcript}</p>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-center space-x-8">
                <div className="w-16 h-16">
                    <button
                        onClick={toggleAudioOutput}
                        className="w-full h-full bg-gray-600/50 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-600/80 transition-colors"
                        aria-label={audioOutput === 'speaker' ? "Switch to earpiece" : "Switch to speaker"}
                    >
                        {audioOutput === 'speaker' ? <SpeakerIcon className="w-8 h-8" /> : <PhoneIcon className="w-8 h-8" />}
                    </button>
                </div>
                <button
                    onClick={handleEndCall}
                    className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 transition-colors transform hover:scale-105"
                    aria-label="End call"
                >
                    <PhoneIcon className="w-10 h-10 rotate-[135deg]" />
                </button>
                <div className="w-16 h-16" /> {/* Spacer */}
            </div>

            <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
        </div >
    );
};

const GeminiLiveVoiceChat: React.FC<VoiceChatOverlayProps> = ({ personality, apiKey, onClose, onSaveTranscript, speechConfig }) => {
    const {
        startSession,
        stopSession,
        connectionState,
        inputTranscript,
        outputTranscript,
        error,
        isSpeakerphoneOn,
        toggleSpeakerphone,
        turnComplete,
        resetTurnComplete
    } = useGeminiLive(personality, apiKey, speechConfig);
    const [showTranscripts, setShowTranscripts] = useState(true);

    // Save transcripts to chat history when turn completes. Gemini Live has already answered
    // by voice: store both sides directly; sendMessage() made the main provider answer again.
    const lastSavedRef = useRef({ input: '', output: '' });

    useEffect(() => {
        if (!turnComplete) return;
        const input = inputTranscript.trim();
        const output = outputTranscript.trim();
        if (onSaveTranscript) {
            if (input && input !== lastSavedRef.current.input) {
                onSaveTranscript('user', input);
                lastSavedRef.current.input = input;
            }
            if (output && output !== lastSavedRef.current.output) {
                onSaveTranscript('model', output);
                lastSavedRef.current.output = output;
            }
        }

        // Reset the turn complete flag
        resetTurnComplete();
    }, [turnComplete, inputTranscript, outputTranscript, onSaveTranscript, resetTurnComplete]);

    useEffect(() => {
        startSession();
        return () => {
            stopSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleEndCall = () => {
        triggerHaptic('HEAVY');
        onClose();
    };

    const handleToggleSpeaker = () => {
        logger.log('debug', '🔊 handleToggleSpeaker called, current state:', isSpeakerphoneOn);
        triggerHaptic('MEDIUM');
        toggleSpeakerphone();
        logger.log('debug', '🔊 toggleSpeakerphone() executed');
    };

    const statusInfo = statusMap[connectionState] || statusMap[0];

    return (
        <div className="fixed inset-0 bg-gray-900/95 backdrop-blur-lg z-50 flex flex-col items-center justify-between p-8 pt-safe pb-safe text-center animate-fade-in">
            <div className="w-full max-w-4xl text-left">
                <h2 className={`text-lg font-medium ${statusInfo.color}`}>{statusInfo.text}</h2>
                {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
            </div>

            <div className="flex flex-col items-center">
                <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
                    <div className={`absolute inset-0 bg-companion-primary rounded-full animate-pulse ${connectionState === 2 ? 'opacity-30' : 'opacity-10'}`}></div>
                    <div className={`absolute inset-4 bg-companion-primary rounded-full animate-pulse [animation-delay:0.5s] ${connectionState === 2 ? 'opacity-20' : 'opacity-5'}`}></div>
                    <div className="w-32 h-32 md:w-40 md:h-40 bg-gradient-to-br from-companion-primary to-companion-secondary rounded-full flex items-center justify-center font-bold text-6xl shadow-2xl">
                        {personality.name.charAt(0)}
                    </div>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold mt-8">{personality.name}</h1>
            </div>

            <div className="w-full max-w-4xl h-32 flex flex-col justify-end">
                {showTranscripts && (
                    <div className="text-lg md:text-xl text-center transition-opacity">
                        <p className="text-gray-400 h-8 truncate">{inputTranscript}</p>
                        <p className="text-white font-medium h-8 truncate">{outputTranscript}</p>
                    </div>
                )}
                <button onClick={() => setShowTranscripts(!showTranscripts)} className="text-xs text-gray-500 mt-2 self-center">
                    {showTranscripts ? "Hide" : "Show"} Transcripts
                </button>
            </div>

            <div className="flex items-center justify-center space-x-8">
                <div className="w-16 h-16">
                    <button
                        onClick={handleToggleSpeaker}
                        className="w-full h-full bg-gray-600/50 rounded-full flex items-center justify-center shadow-lg hover:bg-gray-600/80 transition-colors"
                        aria-label={isSpeakerphoneOn ? "Switch to earpiece" : "Switch to speaker"}
                    >
                        {isSpeakerphoneOn ? <SpeakerIcon className="w-8 h-8" /> : <PhoneIcon className="w-8 h-8" />}
                    </button>
                </div>
                <button
                    onClick={handleEndCall}
                    className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 transition-colors transform hover:scale-105"
                    aria-label="End call"
                >
                    <PhoneIcon className="w-10 h-10 rotate-[135deg]" />
                </button>
                <div className="w-16 h-16" />
            </div>

            <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
        </div>
    );
};

/** Pushes the call's output choice into the TTS engine that plays the replies. */
function applyTtsOutput(ttsProvider: string, output: 'speaker' | 'earpiece') {
    if (ttsProvider === 'piper') {
        import('../../services/tts/piperTTS').then(({ getPiperTtsService }) => {
            getPiperTtsService().setAudioOutput(output).catch(() => { /* logged by the service */ });
        });
    } else if (ttsProvider === 'kokoro') {
        import('../../services/tts/kokoroTTS').then(({ getKokoroTtsService }) => {
            getKokoroTtsService().setAudioOutput(output).catch(() => { /* logged by the service */ });
        });
    }
}

const VoiceChatOverlay: React.FC<VoiceChatOverlayProps> = (props) => {
    // Every configured provider (including Whisper and Kokoro) uses the standard pipeline;
    // Gemini Live is only the fallback for unrecognized ids.
    const useStandard = shouldUseStandardVoiceChat(props.speechConfig?.sttProvider, props.speechConfig?.ttsProvider);

    // The earpiece sets MODE_IN_COMMUNICATION process-wide: restore normal routing when the
    // call ends, or later TTS and other apps stay on call routing/volume.
    useEffect(() => {
        return () => {
            // Hanging up silences the assistant (its onEnd resets isSpeaking)
            stopSpeaking();
            if (Capacitor.isNativePlatform()) {
                AudioOutput.resetAudioMode()
                    .catch((err: unknown) => logger.log('error', 'Failed to reset audio mode', err));
            }
            import('../../services/tts/kokoroTTS').then(({ getKokoroTtsService }) => {
                getKokoroTtsService().setAudioOutput('speaker').catch(() => { /* logged by the service */ });
            });
        };
    }, []);

    if (useStandard) {
        return <StandardVoiceChat {...props} />;
    }

    return <GeminiLiveVoiceChat {...props} />;
};

export default VoiceChatOverlay;
