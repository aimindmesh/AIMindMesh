import { useState } from 'react';
import { LLMConfig, Memory, Message } from '../../types';
import { TranscriptSegment } from '../../types/meeting';
import { generateTextResponseStream } from '../../services/llm/llmService';
import { logger } from '../../services/logger';
import { FileSystemAdapter as Filesystem, Directory } from '../../utils/fileSystemAdapter';

interface UseMeetingAnalysisProps {
    transcript: TranscriptSegment[];
    speakerNames: Record<number, string>;
    playback: any; // Using any for now to avoid circular deps with playback hook types if not exported
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
            const response = await fetch(playback.recordedAudioUrl);
            const audioBlob = await response.blob();
            const mimeType = audioBlob.type || 'audio/webm';

            // Convert blob to base64 for temp file storage
            const arrayBuffer = await audioBlob.arrayBuffer();
            const base64Audio = btoa(
                new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
            );

            let audioPath: string;

            if (isLiteRT) {
                // Save blob to temp file for native processing
                const extension = mimeType.includes('webm') ? 'webm' : (mimeType.includes('mp4') ? 'mp4' : 'wav');
                tempFileName = `temp_meeting_audio_${Date.now()}.${extension}`;

                await Filesystem.writeFile({
                    path: tempFileName,
                    data: base64Audio,
                    directory: Directory.Cache
                });

                // Get the full path for native plugin
                const uriResult = await Filesystem.getUri({
                    path: tempFileName,
                    directory: Directory.Cache
                });
                audioPath = uriResult.uri;
                logger.log('debug', '[MeetingMode] Saved audio to temp file:', audioPath);
            } else {
                // For Gemini, pass data URI
                audioPath = `data:${mimeType};base64,${base64Audio}`;
            }

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
