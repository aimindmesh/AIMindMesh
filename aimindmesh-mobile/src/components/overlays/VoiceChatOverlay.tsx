import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Personality, SpeechConfig } from '../../types';
import { useGeminiLive } from '../../hooks/useGeminiLive';
import { PhoneIcon, SpeakerIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';
import { getOfflineSttService, getOnlineSttService } from '../../services/tts/speech';
import { getVoskSttService } from '../../services/stt/voskSTT';
import { getVoxtralSttService } from '../../services/stt/voxtralSTT'; // Import Voxtral
import { logger } from '../../services/logger';
import { AudioOutput } from 'audio-output-capacitor';

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

    const sttService = speechConfig?.sttProvider === 'voxtral'
        ? getVoxtralSttService()
        : speechConfig?.sttProvider === 'vosk'
            ? getVoskSttService()
            : speechConfig?.sttProvider === 'offline'
                ? getOfflineSttService()
                : getOnlineSttService();

    const handleTranscriptUpdate = useCallback((text: string) => {
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

    // Load STT model if needed (Vosk or Voxtral)
    useEffect(() => {
        const checkAndLoadModel = async () => {
            if (speechConfig?.sttProvider === 'vosk' && speechConfig?.voskModelId) {
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
            } else if (speechConfig?.sttProvider === 'voxtral') {
                const voxtralService = getVoxtralSttService();
                let modelToLoad = speechConfig.voxtralModel;

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
                            transcriptionDelayMs: speechConfig.voxtralLatency,
                            nThreads: speechConfig.voxtralThreads,
                            maxModelLen: speechConfig.voxtralMaxLen
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
    }, [speechConfig?.sttProvider, speechConfig?.voskModelId, speechConfig?.voxtralModel, speechConfig?.voxtralLatency, speechConfig?.voxtralThreads]);

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
            sttService.stop();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            // CRITICAL: Clear transcript when AI starts thinking to prevent contamination
            setTranscript('');
            lastTranscriptRef.current = '';
            // Note: Piper idle timer (in piperTTS.ts) handles memory cleanup after speech ends
        } else if (isSpeaking) {
            setStatus('Speaking...');
            sttService.stop();
            // CRITICAL: Clear transcript when AI starts speaking
            setTranscript('');
            lastTranscriptRef.current = '';
        } else {
            // Only start listening if STT is ready
            if (!isSttReady) {
                if (speechConfig?.sttProvider === 'vosk' || speechConfig?.sttProvider === 'voxtral') {
                    setStatus('Loading model...');
                    return;
                }
            }

            // Initial state before listening
            setStatus('Connecting...');

            // Delay to prevent picking up TTS echo + ensure TTS has fully stopped

            const timer = setTimeout(() => {
                setStatus('Listening');
                sttService.start(handleTranscriptUpdate, apiKey, throttledSetAudioLevel);
            }, 2500);

            return () => {
                clearTimeout(timer);
                sttService.stop();
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            };
        }

        return () => {
            sttService.stop();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
    }, [isLoading, isSpeaking, isSttReady, speechConfig?.sttProvider, sttService, handleTranscriptUpdate, apiKey, throttledSetAudioLevel]);

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

        if (speechConfig?.ttsProvider === 'piper') {
            import('../../services/tts/piperTTS').then(({ getPiperTtsService }) => {
                getPiperTtsService().setAudioOutput(initialOutput);
            });
        }
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
            } else {
                // Fallback for web
                if (speechConfig?.ttsProvider === 'piper') {
                    // Piper might have its own web handling if needed, but usually handled by audio element
                }
            }
        });

        // Keep Piper specific call if it needs internal state update, but native plugin should handle routing
        if (speechConfig?.ttsProvider === 'piper') {
            import('../../services/tts/piperTTS').then(({ getPiperTtsService }) => {
                getPiperTtsService().setAudioOutput(next);
            });
        }
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

const GeminiLiveVoiceChat: React.FC<VoiceChatOverlayProps> = ({ personality, apiKey, onClose, sendMessage, speechConfig }) => {
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

    // Save transcripts to chat history when turn completes
    const lastInputRef = useRef('');

    useEffect(() => {
        if (turnComplete && sendMessage) {
            // Save user input if available and different from last saved
            if (inputTranscript.trim() && inputTranscript !== lastInputRef.current) {
                sendMessage(inputTranscript);
                lastInputRef.current = inputTranscript;
            }

            // Note: We don't save outputTranscript as sendMessage triggers AI generation
            // The AI response is already being generated and saved by the main chat flow

            // Reset the turn complete flag
            resetTurnComplete();
        }
    }, [turnComplete, inputTranscript, outputTranscript, sendMessage, resetTurnComplete]);

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

const VoiceChatOverlay: React.FC<VoiceChatOverlayProps> = (props) => {
    // If STT is offline or TTS is Piper, use StandardVoiceChat
    // Otherwise, default to Gemini Live (if configured)
    // Actually, we should check if the user specifically wants Gemini Live or Standard
    // For now, if offline providers are selected, force Standard

    const sttProv = props.speechConfig?.sttProvider;
    const ttsProv = props.speechConfig?.ttsProvider;

    // Normalize legacy IDs ('gemini'→'online', 'system'→'offline') for backwards compat with old localStorage
    const useStandard = sttProv === 'offline' ||
        sttProv === 'vosk' ||
        sttProv === 'voxtral' ||
        sttProv === 'online' ||
        (sttProv as unknown as string) === 'gemini' ||
        ttsProv === 'piper' ||
        ttsProv === 'offline' ||
        ttsProv === 'online' ||
        (ttsProv as unknown as string) === 'gemini';

    if (useStandard) {
        return <StandardVoiceChat {...props} />;
    }

    return <GeminiLiveVoiceChat {...props} />;
};

export default VoiceChatOverlay;
