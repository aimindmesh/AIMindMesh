import { LLMConfig, TtsProvider, SpeechConfig } from '../../types';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../../utils/audio';
import { logger } from '../logger';
import { getPiperTtsService } from '../tts/piperTTS';
import { getKokoroTtsService } from '../tts/kokoroTTS';
import { requestMicrophonePermission } from '../../utils/permissions';

// Fix for SpeechRecognition API not being in standard TS DOM library
// This adds the necessary types to the global scope to resolve compilation errors.
// See: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new(): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new(): SpeechRecognition;
    };
  }
}

// --- Text-to-Speech (TTS) ---

let ttsAi: GoogleGenAI | null = null;
let lastTtsApiKey: string | null = null;
let ttsAudioContext: AudioContext | null = null;
let currentTtsSource: AudioBufferSourceNode | null = null;

const getTtsAiClient = (apiKey?: string): GoogleGenAI | null => {
  const key = apiKey || process.env.API_KEY;
  if (!key) {
    logger.log('warn', "Online TTS skipped: API key not available.");
    return null;
  }
  try {
    if (!ttsAi || key !== lastTtsApiKey) {
      ttsAi = new GoogleGenAI({ apiKey: key });
      lastTtsApiKey = key;
    }
    return ttsAi;
  } catch (e) {
    logger.log('warn', "Could not initialize online TTS service", e);
    return null;
  }
}

const getTtsAudioContext = async (): Promise<AudioContext> => {
  if (!ttsAudioContext || ttsAudioContext.state === 'closed') {
    ttsAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  // Android WebView keeps AudioContext suspended until explicitly resumed after user gesture
  if (ttsAudioContext.state === 'suspended') {
    await ttsAudioContext.resume();
  }
  return ttsAudioContext;
}

export const unlockTtsAudioContextSync = () => {
  try {
    if (!ttsAudioContext || ttsAudioContext.state === 'closed') {
      ttsAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (ttsAudioContext.state === 'suspended') {
      ttsAudioContext.resume().catch(e => logger.log('warn', 'Failed to resume sync', e));
    }
    const buffer = ttsAudioContext.createBuffer(1, 1, 22050);
    const source = ttsAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(ttsAudioContext.destination);
    source.start(0);
    logger.log('info', 'TTS AudioContext successfully unlocked via sync user gesture.');
  } catch (e) {
    logger.log('warn', 'Failed to unlock TTS AudioContext', e);
  }
};

/**
 * Speaks a given text string using the browser's speech synthesis engine.
 * @param text The text to speak.
 * @param onEnd Optional callback function to execute when speaking finishes.
 */
export const speak = async (text: string, provider: TtsProvider, llmConfig: LLMConfig, speechConfig?: SpeechConfig, apiKey?: string, onEnd?: () => void) => {
  stopSpeaking();

  // Normalize legacy provider IDs stored in old localStorage versions
  if ((provider as string) === 'gemini') provider = 'online';
  if ((provider as string) === 'system') provider = 'offline';

  logger.log('info', `Speaking text (provider: ${provider}, length: ${text.length})`);

  if (provider === 'offline') {
    if (!window.speechSynthesis) {
      logger.log('error', "Browser does not support speech synthesis.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; // Default language
    utterance.rate = 1;
    utterance.pitch = 1;
    if (onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = (e) => {
        logger.log('warn', 'Speech synthesis error', e);
        if (onEnd) onEnd(); // Ensure callback is called even on error
      };
    }
    window.speechSynthesis.speak(utterance);
  } else if (provider === 'online') {
    const ai = getTtsAiClient(apiKey);
    if (!ai) {
      logger.log('warn', "Online TTS skipped: client failed to initialize. Falling back to offline provider.");
      // Fallback to offline TTS
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
      return;
    }
    // IMPORTANT: Only TTS-specific models support Modality.AUDIO via generateContent.
    // Regular chat models (e.g. gemini-3.5-flash) will return no audio and fail silently.
    // Use the user-selected TTS model, falling back to a known TTS model — never a chat model.
    const GEMINI_TTS_FALLBACK = 'gemini-2.5-flash-preview-tts';
    const ttsModel = speechConfig?.geminiTtsModel || GEMINI_TTS_FALLBACK;
    const ttsVoice = speechConfig?.geminiTtsVoice || 'Kore';
    logger.log('info', `Online TTS using model: ${ttsModel}, voice: ${ttsVoice}`);
    try {
      const response = await ai.models.generateContent({
        model: ttsModel,
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: ttsVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioCtx = await getTtsAudioContext();
        const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.onended = () => {
          if (currentTtsSource === source) {
            currentTtsSource = null;
          }
          if (onEnd) onEnd();
        };
        source.start(0);
        currentTtsSource = source;
      } else {
        // No audio returned, call onEnd immediately to avoid UI freeze
        if (onEnd) onEnd();
      }
    } catch (error) {
      logger.log('error', "Error during online TTS generation, falling back to offline.", error);
      // Fallback to offline TTS to avoid freezing UI in 'Speaking...' state
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
    }
  } else if (provider === 'piper') {
    const piperService = getPiperTtsService();
    let isLoaded = piperService.isVoiceLoaded();
    const currentVoice = piperService.getCurrentVoiceId();

    logger.log('info', `Piper check - isSupported: ${piperService.isSupported()}, isLoaded: ${isLoaded}, currentVoice: ${currentVoice}`);

    // Attempt to reload voice if known and not loaded
    if (!isLoaded && speechConfig?.piperVoiceId) {
      logger.log('info', `Piper voice not loaded, attempting reload of: ${speechConfig.piperVoiceId}`);
      try {
        await piperService.loadVoice(speechConfig.piperVoiceId);
        isLoaded = true;
      } catch (e) {
        logger.log('warn', 'Failed to reload Piper voice', e);
      }
    }

    if (!piperService.isSupported() || !isLoaded) {
      logger.log('warn', `Piper TTS not available or no voice loaded (voice: ${currentVoice}). Falling back to offline provider.`);
      // Fallback to offline TTS
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
      return;
    }
    try {
      await piperService.speak(text, onEnd);
    } catch (error) {
      logger.log('error', "Error during Piper TTS", error);
      // Fallback to offline on error
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
    }
  } else if (provider === 'kokoro') {
    const kokoroService = getKokoroTtsService();
    let isLoaded = kokoroService.isVoiceLoaded();
    const currentVoice = kokoroService.getCurrentVoiceId();

    logger.log('info', `Kokoro check - isSupported: ${kokoroService.isSupported()}, isLoaded: ${isLoaded}, currentVoice: ${currentVoice}`);

    // Attempt to reload voice if known and not loaded
    if (!isLoaded && speechConfig?.kokoroVoiceId) {
      logger.log('info', `Kokoro voice not loaded, attempting reload of: ${speechConfig.kokoroVoiceId}`);
      try {
        await kokoroService.loadVoice(speechConfig.kokoroVoiceId);
        isLoaded = true;
      } catch (e) {
        logger.log('warn', 'Failed to reload Kokoro voice', e);
      }
    }

    if (!kokoroService.isSupported() || !isLoaded) {
      logger.log('warn', `Kokoro TTS not available or no voice loaded (voice: ${currentVoice}). Falling back to offline provider.`);
      // Fallback to offline TTS
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
      return;
    }
    try {
      await kokoroService.speak(text, onEnd);
    } catch (error) {
      logger.log('error', "Error during Kokoro TTS", error);
      // Fallback to offline on error
      speak(text, 'offline', llmConfig, speechConfig, apiKey, onEnd);
    }
  }
};

/**
 * Immediately stops any ongoing speech synthesis from all known sources.
 */
export const stopSpeaking = () => {
  // Stop browser-native speech
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    logger.log('debug', 'Stopping browser-native speech synthesis.');
    window.speechSynthesis.cancel();
  }
  // Stop online TTS audio
  if (currentTtsSource) {
    logger.log('debug', 'Stopping online TTS audio source.');
    currentTtsSource.onended = null; // Prevent onEnd from firing on manual stop
    currentTtsSource.stop();
    currentTtsSource = null;
  }
};


// --- Speech-to-Text (STT) ---

/**
 * A stateful service to manage the browser's Speech Recognition API.
 * This represents the 'offline' provider.
 */
class OfflineSpeechToTextService {
  private recognition: SpeechRecognition | null = null;
  private finalTranscript = '';
  private isRunning = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private audioLevelInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Defer initialization to the `start` method to prevent any
    // potential crashes on module load if the SpeechRecognition API is problematic.
  }

  private getApi(): (new () => SpeechRecognition) | null {
    try {
      const Api = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      return Api || null;
    } catch (e) {
      logger.log('warn', 'Could not access SpeechRecognition API', e);
      return null;
    }
  }

  public isSupported(): boolean {
    return !!this.getApi();
  }

  /**
   * Starts the speech recognition process.
   * @param onUpdate A callback that receives the live transcript.
   * @param _apiKey Optional API key (ignored for offline mode, kept for interface consistency).
   * @param onAudioLevel Optional callback for audio level updates (0-1).
   */
  public async start(onUpdate: (transcript: string) => void, _apiKey?: string, onAudioLevel?: (level: number) => void) {
    const SpeechRecognitionAPI = this.getApi();
    if (!SpeechRecognitionAPI || this.isRunning) {
      if (!SpeechRecognitionAPI) {
        logger.log('warn', 'Offline STT is not supported by this browser.');
      }
      return;
    }

    // Initialize Audio Visualization if callback provided
    if (onAudioLevel) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.audioLevelInterval = setInterval(() => {
          if (this.analyser) {
            this.analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const normalized = Math.min(average / 128, 1);
            logger.log('debug', `Offline Audio Level: ${average.toFixed(2)} (Norm: ${normalized.toFixed(2)})`);
            onAudioLevel(normalized);
          }
        }, 100);
      } catch (e) {
        logger.log('warn', 'Could not initialize audio visualization for offline STT', e);
      }
    }

    // Lazy initialization of the SpeechRecognition object on first use
    if (!this.recognition) {
      try {
        this.recognition = new SpeechRecognitionAPI();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
      } catch (e) {
        logger.log('error', 'Failed to initialize SpeechRecognition API', e);
        this.recognition = null;
        return; // Abort if initialization fails
      }
    }

    this.isRunning = true;
    logger.log('info', 'Starting offline STT service.');
    this.finalTranscript = ''; // Reset on start

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      // Reset final transcript from the beginning of results
      this.finalTranscript = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          this.finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      // Provide the combined live transcript
      onUpdate((this.finalTranscript + interimTranscript).trim());
    };

    this.recognition.onend = () => {
      logger.log('debug', 'Offline STT service ended.');
      this.isRunning = false;
    };

    try {
      this.recognition.start();
    } catch (e) {
      logger.log('error', 'Error calling recognition.start()', e);
      this.isRunning = false;
    }
  }

  /**
   * Stops the speech recognition process.
   */
  public stop() {
    if (this.recognition && this.isRunning) {
      logger.log('info', 'Stopping offline STT service.');
      this.isRunning = false; // Set state immediately to prevent race conditions
      this.recognition.stop();
    }

    // Cleanup audio visualization
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
  }
}

class OnlineSpeechToTextService {
  private ai: GoogleGenAI | null = null;
  private sessionPromise: Promise<any> | null = null;

  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private lastApiKey: string | null = null;

  constructor() {
    // API key is now provided at runtime
  }

  public isSupported(): boolean {
    return true; // Assume supported, key is handled at runtime
  }

  private cleanup() {
    this.scriptProcessor?.disconnect();
    this.mediaStreamSource?.disconnect();
    this.audioContext?.close().catch(e => logger.log('warn', 'Error closing online STT audio context', e));
    this.mediaStream?.getTracks().forEach(track => track.stop());

    this.scriptProcessor = null;
    this.mediaStreamSource = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.sessionPromise = null;
  }

  public async start(onUpdate: (transcript: string) => void, apiKey?: string, onAudioLevel?: (level: number) => void) {
    if (this.sessionPromise) return;

    logger.log('info', 'Starting online STT service.');
    let currentTranscript = '';
    let analyser: AnalyserNode | null = null;
    let audioLevelInterval: NodeJS.Timeout | null = null;

    try {
      const key = apiKey || process.env.API_KEY;
      if (!key) throw new Error("Gemini API key not provided.");

      if (!this.ai || key !== this.lastApiKey) {
        this.ai = new GoogleGenAI({ apiKey: key });
        this.lastApiKey = key;
      }

      // Request microphone permission before accessing getUserMedia
      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied. Please grant microphone access in your device settings.');
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            logger.log('info', 'Online STT session opened.');
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream!);
            this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.scriptProcessor.onaudioprocess = (event) => {
              const inputData = event.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              this.sessionPromise?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            this.mediaStreamSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            // Audio Level Visualization
            if (onAudioLevel) {
              analyser = this.audioContext.createAnalyser();
              analyser.fftSize = 256;
              this.mediaStreamSource.connect(analyser);

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              audioLevelInterval = setInterval(() => {
                if (analyser) {
                  analyser.getByteFrequencyData(dataArray);
                  const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                  const normalized = Math.min(average / 128, 1);
                  logger.log('debug', `Online Audio Level: ${average.toFixed(2)} (Norm: ${normalized.toFixed(2)})`);
                  onAudioLevel(normalized);
                }
              }, 100);
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentTranscript += text;
              onUpdate(currentTranscript);
            }
            if (message.serverContent?.turnComplete) {
              currentTranscript = '';
            }
            // We ignore the model's audio output here as we only want transcription
          },
          onerror: (e: ErrorEvent) => {
            logger.log('error', "Online STT session error", e);
            this.stop();
          },
          onclose: () => {
            logger.log('info', 'Online STT session closed.');
            if (audioLevelInterval) clearInterval(audioLevelInterval);
            this.cleanup();
          }
        },
        config: {
          // This is required, but we will ignore the audio output.
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          // Instruct the model to only act as a transcriber.
          systemInstruction: 'You are a transcription service. Do not respond to the user, just listen and transcribe.',
        }
      });

    } catch (e) {
      logger.log('error', "Failed to start online STT session", e);
      this.cleanup();
    }
  }

  public async stop() {
    if (this.sessionPromise) {
      logger.log('info', 'Stopping online STT service.');
      try {
        const session = await this.sessionPromise;
        session.close();
      } catch (e) {
        logger.log('error', "Error closing online STT session", e);
      } finally {
        this.cleanup();
      }
    }
  }
}


// Lazily initialize singleton instances to prevent startup issues.
let _offlineSttService: OfflineSpeechToTextService | null = null;
export const getOfflineSttService = (): OfflineSpeechToTextService => {
  if (!_offlineSttService) {
    _offlineSttService = new OfflineSpeechToTextService();
  }
  return _offlineSttService;
}

let _onlineSttService: OnlineSpeechToTextService | null = null;
export const getOnlineSttService = (): OnlineSpeechToTextService => {
  if (!_onlineSttService) {
    _onlineSttService = new OnlineSpeechToTextService();
  }
  return _onlineSttService;
}