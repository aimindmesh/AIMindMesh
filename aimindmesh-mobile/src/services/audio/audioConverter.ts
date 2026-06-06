import { registerPlugin } from '@capacitor/core';

export interface AudioConverterPlugin {
    convertToM4A(options: { audioData: string; mimeType: string }): Promise<{
        success: boolean;
        audioData: string;
        mimeType: string;
    }>;
    startWriting(options: { sampleRate: number; channels: number }): Promise<void>;
    writeChunk(options: { data: string }): Promise<void>;
    finishWriting(): Promise<{ filePath: string; durationMs: number }>;
    decodeM4AToWav(options: { filePath: string }): Promise<{ filePath: string }>;
}

const AudioConverter = registerPlugin<AudioConverterPlugin>('AudioConverter');

export default AudioConverter;
