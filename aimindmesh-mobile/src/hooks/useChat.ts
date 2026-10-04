import { useState, useCallback, useRef } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { Message, Personality, LLMConfig, SpeechConfig, ResponseStyle, ImageAttachment, AudioAttachment, FileAttachment, AIMindMeshServerSettings } from '../types';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';
import { logger } from '../services/logger';
import { triggerHaptic } from '../services/native';
import { fileToBase64 } from '../utils/fileUtils';
import { stopSpeaking } from '../services/tts/speech';
import { beginChatActivity } from '../services/llm/background/chatActivity';
import { imageGenService } from '../services/image/imageGenService';
import { shrinkImageAttachment } from '../services/image/attachmentImage';
import { imageFromToolData, resolveToolSourceImage, rewriteImagePrompt } from '../services/image/imagePrompt';
import { generateMemorySummary } from '../services/llm/llmService';
import { apiKeyForProvider, effectiveProvider } from './chat/agentLoopHelpers';
import { ChatContext, ApiKeys } from './chat/types';
import { useAgenticLoop } from './chat/useAgenticLoop';

export const useChat = (
    llmConfig: LLMConfig,
    personality: Personality,
    speechConfig: SpeechConfig,
    apiKeys: ApiKeys,
    responseStyle: ResponseStyle,
    autoPlayAudio: boolean,
    context: ChatContext,
    activeThreadId: string | null,
    onUpdateToolRules?: (toolName: string, rule: 'allow' | 'confirm' | 'deny') => void,
    serverSettings?: AIMindMeshServerSettings
) => {
    const [messages, setMessages] = useLocalStorage<Message[]>('chat-history', []);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
    const [pendingAudio, setPendingAudio] = useState<AudioAttachment[]>([]);
    const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);

    // Agentic Loop Hook handles the complex brain logic
    const {
        pendingToolCall,
        setPendingToolCall,
        stopGeneration,
        runAgenticLoop,
        handleConfirmTool,
        isBusy
    } = useAgenticLoop({
        llmConfig,
        personality,
        speechConfig,
        apiKeys,
        responseStyle,
        autoPlayAudio,
        context,
        activeThreadId,
        onUpdateToolRules,
        setMessages,
        setIsLoading,
        setIsSpeaking,
        serverSettings
    });

    const removeImage = (index: number) => {
        setPendingImages(prev => prev.filter((_, idx) => idx !== index));
        triggerHaptic();
    };

    const removeAudio = (index: number) => {
        setPendingAudio(prev => prev.filter((_, i) => i !== index));
        triggerHaptic();
    };

    const removeFile = (index: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== index));
        triggerHaptic();
    };

    const handleAttachImage = useCallback(() => {
        try {
            if (Capacitor.isNativePlatform()) {
                FilePicker.pickImages({ limit: 1, readData: true }).then(result => {
                    if (result.files.length > 0) {
                        const file = result.files[0];
                        if (file.data) {
                            // Photos are shrunk: inline they would fill the chat storage
                            shrinkImageAttachment({
                                base64: file.data,
                                mimeType: file.mimeType || 'image/jpeg',
                                name: file.name || 'image.jpg'
                            }).then(img => setPendingImages(prev => [...prev, img]));
                        }
                    }
                }).catch(err => {
                    logger.log('warn', 'Image pick failed', err);
                    context.showToast('Failed to pick image', 'error');
                });
            } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                        const base64 = await fileToBase64(file);
                        const img = await shrinkImageAttachment({
                            base64,
                            mimeType: file.type || 'image/jpeg',
                            name: file.name
                        });
                        setPendingImages(prev => [...prev, img]);
                    }
                };
                input.click();
            }
            triggerHaptic();
        } catch (error) {
            logger.log('error', 'Failed to pick image', error);
            context.showToast('Error selecting image', 'error');
        }
    }, [context]);

    const handleAttachAudio = async () => {
        triggerHaptic();
        try {
            const result = await FilePicker.pickFiles({
                types: ['audio/*'],
                readData: false,
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                if (!file.path) {
                    context.showToast('Cannot get file path', 'error');
                    return;
                }

                const newAudio: AudioAttachment = {
                    path: file.path,
                    name: file.name || 'audio.wav',
                    mimeType: file.mimeType || 'audio/wav',
                    duration: file.duration || 0
                };
                setPendingAudio(prev => [...prev, newAudio]);
            }
        } catch (error) {
            logger.log('warn', 'Audio pick cancelled or failed', error);
        }
    };

    const handleAttachFile = async () => {
        triggerHaptic();
        try {
            const result = await FilePicker.pickFiles({
                types: ['text/plain', 'text/markdown', 'application/json', 'text/csv', 'application/pdf'], // Extended types
                readData: true,
            });

            if (result.files.length > 0) {
                const file = result.files[0];
                let content = '';

                if (file.data) {
                    // FilePicker returns base64 for readData: true usually? Or text?
                    // On web it sends base64. On native it might handle differently.
                    // IMPORTANT: The @capawesome/capacitor-file-picker docs say `data` is base64 string.
                    // We need to decode it if it's base64.
                    try {
                        content = atob(file.data);
                    } catch (e) {
                        // Fallback if it's already text (unlikely but safe)
                        content = file.data;
                    }
                } else {
                    context.showToast('Could not read file data', 'error');
                    return;
                }

                // Sanitation: Limit content size if needed? For now allow.

                setPendingFiles(prev => [...prev, {
                    name: file.name || 'file.txt',
                    content: content,
                    mimeType: file.mimeType || 'text/plain'
                }]);
            }
        } catch (error) {
            logger.log('warn', 'File pick cancelled or failed', error);
        }
    };

    // True from the moment a message is accepted until its run has started (attachments and
    // image generation are awaited first): a second send meanwhile is ignored
    const sendingRef = useRef(false);

    const triggerAIResponse = useCallback((history: Message[]) => {
        if (isBusy()) return;
        runAgenticLoop(history);
    }, [runAgenticLoop, isBusy]);

    const addPendingImage = useCallback((img: ImageAttachment) => {
        triggerHaptic();
        shrinkImageAttachment(img).then(small => setPendingImages(prev => [...prev, small]));
    }, []);

    const sendMessage = useCallback(async (textToSend: string, options?: { hidden?: boolean, role?: 'user' | 'system' }) => {
        if (!textToSend && pendingImages.length === 0 && pendingAudio.length === 0 && pendingFiles.length === 0) return;
        // One answer at a time (Enter while streaming, voice input, Gemini Live turns)
        if (sendingRef.current || isBusy()) return;
        sendingRef.current = true;
        // The chat is busy from now on: background work waits (or is stopped by the run)
        const endSending = beginChatActivity();

        triggerHaptic();
        stopSpeaking();
        setIsSpeaking(false);

        const userInput: Message = {
            id: Date.now().toString(),
            role: options?.role || 'user',
            text: textToSend,
            timestamp: new Date(),
            images: pendingImages.length > 0 ? [...pendingImages] : undefined,
            audio: pendingAudio.length > 0 ? [...pendingAudio] : undefined,
            files: pendingFiles.length > 0 ? [...pendingFiles] : undefined,
            hidden: options?.hidden
        };


        // Clear input state immediately
        setInput('');
        setPendingImages([]);
        setPendingAudio([]);
        setPendingFiles([]);

        const trimmed = textToSend.trim();

        // /image (/draw) and /edit run on the NPU: the chat LLM, still in RAM, first turns the request
        // into an English Stable Diffusion prompt; then it leaves the RAM to SD and comes back
        const imageCommand = /^\/(image|draw|edit)\s+/.exec(trimmed);
        if (imageCommand) {
            const editing = imageCommand[1] === 'edit';
            const request = trimmed.slice(imageCommand[0].length).trim();
            setMessages(prev => [...prev, userInput]);
            setIsLoading(true);
            const reply = (text: string, images?: ImageAttachment[]) => setMessages(prev =>
                [...prev, { id: (Date.now() + 1).toString(), role: 'model', text, timestamp: new Date(), images }]);
            try {
                // The attached image, else the newest one in the chat (e.g. the last generated)
                const source = editing ? resolveToolSourceImage('last', [...messages, userInput]) : {};
                if (source.error) throw new Error('attach the image to edit (or generate one first), then use /edit');
                const apiKey = apiKeyForProvider(effectiveProvider(llmConfig, serverSettings), apiKeys, llmConfig);
                const prompt = await rewriteImagePrompt(request, editing ? 'edit' : 'generate',
                    instruction => generateMemorySummary(instruction, llmConfig, apiKey));
                const genResult = await imageGenService.generateFromChat({ prompt, sourceImage: source.source });
                const image = imageFromToolData(genResult);
                reply(`${editing ? 'Modified' : 'Generated'} on the Hexagon NPU in ${(genResult.generationTimeMs / 1000).toFixed(1)}s` +
                    `${genResult.seed !== undefined ? ` · seed ${genResult.seed}` : ''}\nPrompt: "${prompt}"`, image ? [image] : undefined);
            } catch (err: any) {
                reply(`⚠️ Image ${editing ? 'modification' : 'generation'} failed: ${err.message || 'Unknown error'}`);
            } finally {
                setIsLoading(false);
                sendingRef.current = false;
                endSending();
            }
            return;
        }

        const newHistory = [...messages, userInput];
        // Raw messages are not stored as memories (questions and small talk crowded them out):
        // the background consolidation writes facts and a summary of the conversation

        sendingRef.current = false; // The run takes over (it marks itself busy before its first await)
        runAgenticLoop(newHistory);
        endSending();
    }, [pendingImages, pendingAudio, pendingFiles, messages, runAgenticLoop, isBusy, setInput, llmConfig, activeThreadId, setMessages, apiKeys, serverSettings]);

    const handleResend = useCallback((message: Message) => {
        sendMessage(message.text);
    }, [sendMessage]);

    const handleRegenerate = useCallback((message: Message) => {
        const index = messages.findIndex(m => m.id === message.id);
        if (index === -1) return;
        if (message.role === 'model') {
            const newHistory = messages.slice(0, index);
            triggerAIResponse(newHistory);
        }
    }, [messages, triggerAIResponse]);

    const handleStopSpeaking = useCallback(() => {
        stopSpeaking();
        setIsSpeaking(false);
    }, []);

    return {
        messages, setMessages,
        input, setInput,
        isLoading,
        isSpeaking,
        pendingImages, removeImage, handleAttachImage, addPendingImage,
        pendingAudio, removeAudio, handleAttachAudio,
        pendingFiles, removeFile, handleAttachFile,
        pendingToolCall, setPendingToolCall,
        sendMessage,
        stopGeneration,
        handleResend,
        handleRegenerate,
        triggerAIResponse,
        handleConfirmTool,
        stopSpeaking: handleStopSpeaking
    };
};
