import { registerPlugin } from '@capacitor/core';

export interface AudioConverterPlugin {
    convertToM4A(options: { audioData: string; mimeType: string }): Promise<{
        success: boolean;
        audioData: string;
        mimeType: string;
    }>;
    /** Decodes any audio file to a 16 kHz mono WAV in the cache; the caller deletes it when done */
    decodeM4AToWav(options: { filePath: string }): Promise<{ filePath: string }>;
    /**
     * Imports an audio file: 16 kHz mono WAV in the cache (deleted by the caller) and, with a
     * meetingId, the meeting's AAC file meeting-audio/{id}.audio.
     */
    decodeAudioFile(options: { filePath: string; meetingId?: string }): Promise<{
        wavPath: string;
        m4aPath?: string;
        durationMs: number;
    }>;
}

const AudioConverter = registerPlugin<AudioConverterPlugin>('AudioConverter');

export default AudioConverter;
