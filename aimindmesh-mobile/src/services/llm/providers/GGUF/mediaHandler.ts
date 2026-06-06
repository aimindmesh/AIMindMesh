import { Message } from '../../../../types';
import { logger } from '../../../logger';
import { getWhisperSTTService } from '../../../stt/whisperSTT';

export async function processAudioAttachments(history: Message[]): Promise<Message[]> {
    // Check for Audio attachments (Audio Analysis via Transcription)
    // We create a working copy of history to modify message text with transcripts without affecting UI state immediately
    const workingHistory = history.map(m => ({ ...m }));
    const hasAudio = workingHistory.some(m => m.audio && m.audio.length > 0);

    if (hasAudio) {
        try {
            const whisperService = getWhisperSTTService();
            // Check if model is loaded. If not, we can't analyze audio.
            // In a real scenario, we might auto-load, but here we check availability.
            const isLoaded = await whisperService.checkModelLoaded();

            if (isLoaded) {
                for (const msg of workingHistory) {
                    if (msg.audio && msg.audio.length > 0) {
                        for (const audio of msg.audio) {
                            // Use cached transcription if available
                            if (!audio.transcription) {
                                logger.log('info', `GGUF: Transcribing audio ${audio.name}`);
                                try {
                                    // Transcribe
                                    const result = await whisperService.transcribeFile(audio.path);
                                    audio.transcription = result.text;
                                } catch (e) {
                                    logger.log('error', `GGUF: Failed to transcribe ${audio.name}`, e);
                                    audio.transcription = "[Audio Transcription Failed]";
                                }
                            }

                            if (audio.transcription) {
                                // Append transcript to message text so LLM can "analyze" it
                                msg.text += `\n\n[Audio Transcript (${audio.name})]:\n${audio.transcription}`;
                            }
                        }
                    }
                }
                logger.log('info', 'GGUF: Audio transcripts injected into context');
            } else {
                logger.log('warn', 'GGUF: Audio present but Whisper model not loaded. Skipping analysis.');
            }
        } catch (error) {
            logger.log('warn', 'GGUF: Error processing audio attachments', error);
        }
    }
    return workingHistory;
}

export async function prepareImagesForProcessing(history: Message[]): Promise<string[]> {
    // Collect all images from the history for native processing
    const imagesToProcess: string[] = [];

    // Sequentially process messages to handle async file reading if needed
    for (const msg of history) {
        if (msg.images && msg.images.length > 0) {
            for (const img of msg.images) {
                // Extract base64 data, handling both with and without prefix
                let base64 = img.base64;

                // If base64 is missing but path is present, read the file
                if (!base64 && img.path) {
                    try {
                        const { FileSystemAdapter: Filesystem } = await import('../../../../utils/fileSystemAdapter');
                        const result = await Filesystem.readFile({ path: img.path });
                        base64 = result.data as string;
                    } catch (e) {
                        logger.log('error', `GGUF: Failed to read image file at ${img.path}`, e);
                    }
                }

                if (base64) {
                    if (base64.includes('base64,')) {
                        base64 = base64.split('base64,')[1];
                    }
                    // Re-add standard prefix for C++ processing
                    const fullDataUrl = `data:${img.mimeType || 'image/jpeg'};base64,${base64}`;
                    imagesToProcess.push(fullDataUrl);
                }
            }
        }
    }

    if (imagesToProcess.length > 0) {
        logger.log('info', `Passing ${imagesToProcess.length} images to native layer`);
    }

    return imagesToProcess;
}
