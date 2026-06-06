import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Personality, SpeechConfig } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audio';
import { logger } from '../services/logger';
import { AudioOutput } from 'audio-output-capacitor';
import { requestMicrophonePermission } from '../utils/permissions';
//import { Capacitor } from '@capacitor/core';


enum ConnectionState {
  IDLE,
  CONNECTING,
  CONNECTED,
  DISCONNECTED,
  ERROR,
}


export const useGeminiLive = (personality: Personality, apiKey?: string, speechConfig?: SpeechConfig) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.IDLE);
  const [inputTranscript, setInputTranscript] = useState('');
  const [outputTranscript, setOutputTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnComplete, setTurnComplete] = useState(false);


  // Audio output state
  const [isSpeakerphoneOn, setIsSpeakerphoneOn] = useState(false);
  const [canToggleSpeakerphone, setCanToggleSpeakerphone] = useState(false);
  const speakerSinkIdRef = useRef<string>('default');
  const defaultSinkIdRef = useRef<string>('default');


  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const inputGainNodeRef = useRef<GainNode | null>(null);
  const isAiSpeakingRef = useRef(false);

  // Audio output refs
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);


  const toggleSpeakerphone = useCallback(() => {
    setIsSpeakerphoneOn(prev => {
      const newValue = !prev;
      logger.log('info', `Toggling speakerphone from ${prev} to ${newValue} (${newValue ? 'SPEAKER' : 'EARPIECE'})`);
      return newValue;
    });
  }, []);

  useEffect(() => {
    logger.log('debug', `isSpeakerphoneOn state changed to: ${isSpeakerphoneOn} (${isSpeakerphoneOn ? 'SPEAKER' : 'EARPIECE'})`);

    // Use native plugin on Capacitor platforms
    import('@capacitor/core').then(({ Capacitor }) => {
      if (Capacitor.isNativePlatform()) {
        logger.log('info', `Setting speakerphone via native plugin to: ${isSpeakerphoneOn}`);
        AudioOutput.setSpeakerphoneOn({ enabled: isSpeakerphoneOn })
          .then(() => logger.log('info', `Native speakerphone successfully set to ${isSpeakerphoneOn ? 'ON (SPEAKER)' : 'OFF (EARPIECE)'}`))
          .catch((err: any) => logger.log('error', 'Failed to set speakerphone via native plugin', err));
      } else {
        // Fallback to web API setSinkId
        const audioEl = audioElementRef.current;
        if (audioEl && typeof audioEl.setSinkId === 'function') {
          const newSinkId = isSpeakerphoneOn ? speakerSinkIdRef.current : defaultSinkIdRef.current;
          logger.log('info', `Attempting to set audio output to ${newSinkId} via setSinkId`);
          audioEl.setSinkId(newSinkId)
            .then(() => logger.log('info', `Audio output successfully set to device ${newSinkId}`))
            .catch(err => logger.log('error', 'Failed to set audio output device', err));
        } else {
          logger.log('warn', `Cannot set audio output - audioEl: ${audioEl}, setSinkId: ${audioEl && typeof audioEl.setSinkId}`);
        }
      }
    });
  }, [isSpeakerphoneOn]);


  const cleanup = useCallback(() => {
    logger.log("debug", "Cleaning up audio resources for Gemini Live...");
    workletNodeRef.current?.disconnect();
    inputGainNodeRef.current?.disconnect();
    mediaStreamSourceRef.current?.disconnect();
    inputAudioContextRef.current?.close().catch(e => logger.log('warn', 'Error closing input audio context', e));
    outputAudioContextRef.current?.close().catch(e => logger.log('warn', 'Error closing output audio context', e));
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());


    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.srcObject = null;
      audioElementRef.current = null;
    }
    mediaStreamDestinationRef.current = null;


    outputSourcesRef.current.forEach(source => source.stop());
    outputSourcesRef.current.clear();

    workletNodeRef.current = null;
    inputGainNodeRef.current = null;
    mediaStreamSourceRef.current = null;
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    mediaStreamRef.current = null;
    nextStartTimeRef.current = 0;
    isAiSpeakingRef.current = false;
  }, []);


  const stopSession = useCallback(async () => {
    logger.log("info", "Stopping Gemini Live session...");
    setConnectionState(ConnectionState.DISCONNECTED);
    try {
      if (sessionPromiseRef.current) {
        const session = await sessionPromiseRef.current;
        session.close();
        sessionPromiseRef.current = null;
      }
    } catch (e) {
      logger.log('error', "Error closing Gemini Live session", e);
    } finally {
      cleanup();
    }
  }, [cleanup]);


  const startSession = useCallback(async () => {
    if (connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.CONNECTED) {
      logger.log('warn', 'Session already connecting or connected, skipping start');
      return;
    }

    logger.log('info', '🎙️ Attempting to start Gemini Live session...');

    const key = apiKey || process.env.API_KEY;
    if (!key) {
      const errorMessage = "Gemini API key is not configured.";
      setError(errorMessage);
      setConnectionState(ConnectionState.ERROR);
      logger.log('error', '❌ Cannot start Gemini Live: API key is missing.');
      return;
    }
    logger.log('info', '✅ API key found, proceeding with session initialization');


    if (!aiRef.current) {
      try {
        aiRef.current = new GoogleGenAI({ apiKey: key });
        logger.log('info', 'Initialized new Gemini AI client for Live session.');
      } catch (e) {
        logger.log('error', "Failed to initialize Gemini AI client for Live session", e);
        setError("Failed to initialize Gemini client. Check API key.");
        setConnectionState(ConnectionState.ERROR);
        return;
      }
    }


    setConnectionState(ConnectionState.CONNECTING);
    setError(null);
    setInputTranscript('');
    setOutputTranscript('');
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';


    try {
      // Request microphone permission before accessing getUserMedia
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied. Please grant microphone access in your device settings.');
      }

      // getUserMedia gestisce automaticamente la richiesta dei permessi
      // sia su web che su piattaforme native (se configurati nel manifest)
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });


      // Enumera i dispositivi DOPO aver ottenuto i permessi
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputDevices = allDevices.filter(d => d.kind === 'audiooutput');
        logger.log('debug', 'Available audio output devices', audioOutputDevices);
        if (audioOutputDevices.length > 1) {
          setCanToggleSpeakerphone(true);
          const speakerDevice = audioOutputDevices.find(d => d.label.toLowerCase().includes('speaker'));
          speakerSinkIdRef.current = speakerDevice?.deviceId ?? 'default';
          const defaultDevice = audioOutputDevices.find(d => d.deviceId === 'default');
          const nonSpeakerDevice = audioOutputDevices.find(d => !d.label.toLowerCase().includes('speaker'));
          defaultSinkIdRef.current = defaultDevice?.deviceId ?? nonSpeakerDevice?.deviceId ?? 'default';
        }
      } catch (e) {
        logger.log('warn', 'Could not enumerate devices', e);
      }

      sessionPromiseRef.current = aiRef.current.live.connect({
        model: speechConfig?.geminiSttModel || 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: async () => {
            logger.log('info', '✅ Gemini Live session opened successfully!');
            setConnectionState(ConnectionState.CONNECTED);

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

            // Set up audio routing for output device selection
            const outCtx = outputAudioContextRef.current;
            mediaStreamDestinationRef.current = outCtx.createMediaStreamDestination();
            audioElementRef.current = new Audio();
            audioElementRef.current.srcObject = mediaStreamDestinationRef.current.stream;
            const initialSinkId = isSpeakerphoneOn ? speakerSinkIdRef.current : defaultSinkIdRef.current;
            if (typeof audioElementRef.current.setSinkId === 'function') {
              audioElementRef.current.setSinkId(initialSinkId).catch(e => logger.log('warn', 'Could not set initial sinkId', e));
            }
            audioElementRef.current.play().catch(e => logger.log('warn', 'Audio autoplay was prevented.', e));


            mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current!);

            // Create gain node for echo cancellation - allows us to mute mic when AI is speaking
            inputGainNodeRef.current = inputAudioContextRef.current.createGain();
            inputGainNodeRef.current.gain.value = 1.0; // Start unmuted

            // Load AudioWorklet for low-latency audio processing
            try {
              await inputAudioContextRef.current.audioWorklet.addModule('/audio-worklet.js');

              workletNodeRef.current = new AudioWorkletNode(
                inputAudioContextRef.current,
                'audio-recorder',
                {
                  numberOfInputs: 1,
                  numberOfOutputs: 1,
                  channelCount: 1,
                  channelCountMode: 'explicit'
                }
              );

              // Handle audio data from worklet - send to Gemini Live
              workletNodeRef.current.port.onmessage = (event) => {
                if (event.data.audioChunk) {
                  // New streaming protocol
                  const int16Data = event.data.audioChunk;
                  const float32Data = new Float32Array(int16Data.length);
                  for (let i = 0; i < int16Data.length; i++) {
                    float32Data[i] = int16Data[i] / 32768.0;
                  }
                  const pcmBlob = createBlob(float32Data);
                  sessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                  });
                } else if (event.data.audioData) {
                  // Legacy protocol (fallback)
                  const int16Data = event.data.audioData;
                  const float32Data = new Float32Array(int16Data.length);
                  for (let i = 0; i < int16Data.length; i++) {
                    float32Data[i] = int16Data[i] / 32768.0;
                  }
                  const pcmBlob = createBlob(float32Data);
                  sessionPromiseRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                  });
                }
              };

              // Start recording in worklet with low latency configuration (4096 samples = ~256ms)
              workletNodeRef.current.port.postMessage({
                command: 'start',
                chunkInterval: 4096
              });

              // Route: MediaStreamSource -> GainNode -> AudioWorklet -> Destination (muted)
              mediaStreamSourceRef.current.connect(inputGainNodeRef.current);
              inputGainNodeRef.current.connect(workletNodeRef.current);

              // Muted output to keep the graph active
              const zeroGain = inputAudioContextRef.current.createGain();
              zeroGain.gain.value = 0;
              workletNodeRef.current.connect(zeroGain);
              zeroGain.connect(inputAudioContextRef.current.destination);

              logger.log('info', '✅ AudioWorklet setup complete for Gemini Live @ 16kHz');
            } catch (workletError) {
              logger.log('error', 'Failed to setup AudioWorklet, falling back to ScriptProcessor', workletError);

              // Fallback to deprecated ScriptProcessor if AudioWorklet fails
              const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
              scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromiseRef.current?.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };

              mediaStreamSourceRef.current.connect(inputGainNodeRef.current);
              inputGainNodeRef.current.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContextRef.current.destination);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            logger.log('debug', 'Received message from Gemini Live', message);
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscriptionRef.current += text;
              setOutputTranscript(currentOutputTranscriptionRef.current);
              logger.log('debug', `🤖 AI output: ${text}`);

              // CRITICAL: Mute microphone when AI starts speaking to prevent echo/contamination
              if (!isAiSpeakingRef.current && inputGainNodeRef.current) {
                logger.log('debug', '🔇 Muting microphone - AI is speaking');
                inputGainNodeRef.current.gain.value = 0.0;
                isAiSpeakingRef.current = true;
              }
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscriptionRef.current += text;
              setInputTranscript(currentInputTranscriptionRef.current);
              logger.log('debug', `🎤 User input: ${text}`);
            }

            if (message.serverContent?.turnComplete) {
              logger.log('debug', 'Gemini Live turn complete.');
              setTurnComplete(true);
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';

              // CRITICAL: Unmute microphone after AI finishes speaking (with small delay)
              setTimeout(() => {
                if (inputGainNodeRef.current && isAiSpeakingRef.current) {
                  logger.log('debug', '🔊 Unmuting microphone - turn complete');
                  inputGainNodeRef.current.gain.value = 1.0;
                  isAiSpeakingRef.current = false;
                }
              }, 500); // 500ms delay to ensure audio output has finished
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const outCtx = outputAudioContextRef.current;
              const destination = mediaStreamDestinationRef.current;
              if (outCtx && destination) {
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
                const source = outCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(destination);

                source.addEventListener('ended', () => {
                  outputSourcesRef.current.delete(source);
                });

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                outputSourcesRef.current.add(source);
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            logger.log('error', "Gemini Live session error", e);
            setError(`Session error: ${e.message}`);
            setConnectionState(ConnectionState.ERROR);
            stopSession();
          },
          onclose: (e: CloseEvent) => {
            logger.log('info', "Gemini Live session closed", e);
            if (connectionState !== ConnectionState.DISCONNECTED) {
              setConnectionState(ConnectionState.DISCONNECTED);
              cleanup();
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speechConfig?.geminiTtsVoice || 'Kore' } },
          },
          systemInstruction: [
            speechConfig?.geminiSttLanguage === 'en-US'
              ? 'Always respond in English.'
              : 'Rispondi sempre in italiano.',
            `You are ${personality.name}. ${personality.systemPrompt}.`,
            'Your responses will be used in a real-time voice conversation, so keep them very short and conversational.'
          ].join(' ')
        },
      });


    } catch (e) {
      let errorMessage = `Failed to get microphone access. ${e instanceof Error ? e.message : String(e)}`;
      if (e instanceof Error) {
        if (e.name === 'NotAllowedError' || e.message.includes("permission")) {
          errorMessage = "Microphone access was denied. Please enable it in your browser or device settings and try again.";
        } else if (e.name === 'NotFoundError') {
          errorMessage = "No microphone was found on your device. Please connect a microphone and try again.";
        }
      }
      logger.log('error', "Failed to start Gemini Live session", e, { customMessage: errorMessage });
      setError(errorMessage);
      setConnectionState(ConnectionState.ERROR);
      cleanup();
    }
  }, [connectionState, personality, cleanup, stopSession, isSpeakerphoneOn, apiKey]);

  useEffect(() => {
    return () => {
      if (sessionPromiseRef.current) {
        stopSession();
      }
    };
  }, [stopSession]);

  const resetTurnComplete = useCallback(() => {
    setTurnComplete(false);
  }, []);

  return { startSession, stopSession, connectionState, inputTranscript, outputTranscript, error, isSpeakerphoneOn, toggleSpeakerphone, canToggleSpeakerphone, turnComplete, resetTurnComplete };
};