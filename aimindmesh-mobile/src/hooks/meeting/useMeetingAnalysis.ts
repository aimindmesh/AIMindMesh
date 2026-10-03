import { useState } from 'react';
import { LLMConfig, Memory, Message } from '../../types';
import { TranscriptSegment } from '../../types/meeting';
import { generateTextResponseStream } from '../../services/llm/llmService';
import { logger } from '../../services/logger';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';
import { blobToBase64, filesystemRefFor } from '../../services/meeting/meetingStorage';
import { audioExtensionForMime, guessAudioMimeType } from '../../services/meeting/audioPaths';

interface UseMeetingAnalysisProps {
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    playback: any; // Using any for now to avoid circular deps with playback hook types if not exported
    /** Plain path of the saved meeting audio, when there is one */
    audioFilePathRef?: React.MutableRefObject<string | null>;
    llmConfig: LLMConfig;
    personality: any;
    memories?: Memory[];
    apiKey?: string;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const useMeetingAnalysis = ({
    transcript,
    speakerNames,
    playback,
    audioFilePathRef,
    llmConfig,
    personality,
    memories,
    apiKey,
    showToast
}: UseMeetingAnalysisProps) => {
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [analysisResult, setAnalysisResult] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleAnalyze = async () => {
        if (transcript.length === 0) {
            showToast('No transcript to analyze', 'info');
            return;
        }

        setIsAnalyzing(true);
        setShowAnalysis(true);
        setAnalysisResult('');

        const context = transcript.map(t => {
            const name = speakerNames[t.speakerId] || `Speaker ${t.speakerId + 1}`;
            return `${name}: ${t.text}`;
        }).join('\n');

        const prompt = "Analyze this meeting. Provide a short summary and a list of key points or action items.";

        try {
            const analysisHistory = [
                { id: 'context', role: 'user' as const, text: `MEETING TRANSCRIPT:\n\n${context}\n\n${prompt}`, timestamp: new Date() }
            ];

            const stream = generateTextResponseStream(
                analysisHistory,
                personality,
                llmConfig,
                memories,
                apiKey,
                undefined
            );

            for await (const chunk of stream) {
                if (typeof chunk === 'string') {
                    setAnalysisResult((prev: string) => prev + chunk);
                } else if (chunk.type === 'text' && chunk.content) {
                    setAnalysisResult((prev: string) => prev + chunk.content);
                }
            }
        } catch (error) {
            logger.log('error', 'Analysis failed', error);
            setAnalysisResult('Analysis error.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleAnalyzeAudio = async () => {
        if (!playback.recordedAudioUrl) {
            showToast('No recorded audio', 'info');
            return;
        }

        // Check if provider supports audio
        const isLiteRT = llmConfig.provider === 'litert' ||
            (llmConfig.provider === 'native-gguf' && llmConfig.engine === 'litert' && llmConfig.liteRTModelPath);
        const isGemini = llmConfig.provider === 'gemini';

        if (!isLiteRT && !isGemini) {
            showToast(`Provider ${llmConfig.provider} does not support audio. Using text analysis.`, 'info');
            await handleAnalyze();
            return;
        }

        setIsAnalyzing(true);
        setShowAnalysis(true);
        setAnalysisResult('');

        let tempFileName: string | null = null;

        try {
            let audioPath: string;
            let mimeType: string;
            const storedPath = audioFilePathRef?.current ?? null;

            if (isLiteRT && storedPath) {
                // Native copy with a real extension: the recording never goes through JS memory
                mimeType = guessAudioMimeType(storedPath);
                tempFileName = `temp_meeting_audio_${Date.now()}.${audioExtensionForMime(mimeType)}`;
                const source = filesystemRefFor(storedPath);
                await Filesystem.copy({ from: source.path, directory: source.directory, to: tempFileName, toDirectory: Directory.Cache });
                audioPath = (await Filesystem.getUri({ path: tempFileName, directory: Directory.Cache })).uri;
            } else {
                const audioBlob = await (await fetch(playback.recordedAudioUrl)).blob();
                mimeType = audioBlob.type || (storedPath ? guessAudioMimeType(storedPath) : 'audio/webm');
                // FileReader encodes natively (the byte-by-byte string build froze on long meetings)
                const base64Audio = await blobToBase64(audioBlob);

                if (isLiteRT) {
                    // Save blob to temp file for native processing
                    tempFileName = `temp_meeting_audio_${Date.now()}.${audioExtensionForMime(mimeType)}`;
                    await Filesystem.writeFile({
                        path: tempFileName,
                        data: base64Audio,
                        directory: Directory.Cache
                    });
                    audioPath = (await Filesystem.getUri({ path: tempFileName, directory: Directory.Cache })).uri;
                } else {
                    // For Gemini, pass data URI
                    audioPath = `data:${mimeType};base64,${base64Audio}`;
                }
            }
            logger.log('debug', '[MeetingMode] Audio prepared for analysis:', isLiteRT ? audioPath : mimeType);

            const prompt = "Analyze the audio content of this meeting. Provide a short summary and a list of key points or action items.";

            // Create a simplified personality for audio analysis (no tools/thinking)
            const analysisPersonality = {
                ...personality,
                systemPrompt: `You are ${personality.name}. ${personality.description || ''} Analyze the audio content provided and give a helpful summary.`
            };

            // Disable tools and thinking for clean audio analysis
            const analysisConfig = {
                ...llmConfig,
                enableToolCalling: false,
                enableThinking: false,
                enableSearch: false
            };

            logger.log('info', `[MeetingMode] Audio analysis - Provider: ${llmConfig.provider}, Engine: ${llmConfig.engine}, Audio chunks: 1`);

            const analysisHistory: Message[] = [{
                id: 'audio_analysis_' + Date.now(),
                role: 'user' as const,
                text: prompt,
                timestamp: new Date(),
                audio: [{
                    path: audioPath,
                    name: 'meeting_audio',
                    mimeType: mimeType
                }]
            }];

            const stream = generateTextResponseStream(
                analysisHistory,
                analysisPersonality,
                analysisConfig,
                memories,
                apiKey,
                undefined
            );

            for await (const chunk of stream) {
                if (typeof chunk === 'string') {
                    setAnalysisResult((prev: string) => prev + chunk);
                } else if (chunk.type === 'text' && chunk.content) {
                    setAnalysisResult((prev: string) => prev + chunk.content);
                }
            }
        } catch (error) {
            logger.log('error', 'Audio analysis failed', error);
            setAnalysisResult('Audio analysis error: ' + (error as Error).message);
        } finally {
            if (tempFileName) {
                try {
                    await Filesystem.deleteFile({
                        path: tempFileName,
                        directory: Directory.Cache
                    });
                } catch (cleanupError) {
                    // Ignore cleanup errors
                }
            }
            setIsAnalyzing(false);
        }
    };

    return {
        showAnalysis,
        setShowAnalysis,
        analysisResult,
        setAnalysisResult,
        isAnalyzing,
        setIsAnalyzing,
        handleAnalyze,
        handleAnalyzeAudio
    };
};
