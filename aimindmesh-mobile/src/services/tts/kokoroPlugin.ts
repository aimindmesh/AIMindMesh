import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface KokoroTTSPlugin {
    isVoiceLoaded(): Promise<{ loaded: boolean }>;
    getVoiceInfo(): Promise<{ voiceId: string }>;
    
    // Model Downloader methods
    isModelReady(): Promise<{ ready: boolean }>;
    downloadModel(): Promise<void>;
    importModel(options: { path: string }): Promise<void>;
    
    addListener(eventName: 'onDownloadProgress', listenerFunc: (data: { progress: number, message: string }) => void): Promise<PluginListenerHandle> & PluginListenerHandle;
    addListener(eventName: 'onDownloadComplete', listenerFunc: () => void): Promise<PluginListenerHandle> & PluginListenerHandle;
    addListener(eventName: 'onDownloadError', listenerFunc: (data: { error: string }) => void): Promise<PluginListenerHandle> & PluginListenerHandle;
    
    loadVoice(options: { voiceId: string }): Promise<void>;
    unloadVoice(): Promise<void>;
    speak(options: { text: string }): Promise<void>;
    stop(): Promise<void>;
    setAudioOutput(options: { output: string }): Promise<void>;
    getAvailableAudioOutputs(): Promise<{ outputs: string[] }>;
}

export const Kokoro = registerPlugin<KokoroTTSPlugin>('KokoroTTS');
