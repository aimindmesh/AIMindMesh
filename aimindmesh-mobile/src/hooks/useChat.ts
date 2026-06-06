import { useState, useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { Message, Personality, LLMConfig, SpeechConfig, ResponseStyle, ImageAttachment, AudioAttachment, FileAttachment, AIMindMeshServerSettings } from '../types';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';
import { logger } from '../services/logger';
import { triggerHaptic } from '../services/native';
import { fileToBase64 } from '../utils/fileUtils';
import { stopSpeaking } from '../services/tts/speech';
import { getOrInitializeSemanticMemoryRetriever } from '../services/memory/semanticMemoryRetriever';
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
        handleConfirmTool
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
                            setPendingImages(prev => [...prev, {
                                base64: file.data!,
                                mimeType: file.mimeType || 'image/jpeg',
                                name: file.name || 'image.jpg'
                            }]);
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
                        setPendingImages(prev => [...prev, {
                            base64,
                            mimeType: file.type || 'image/jpeg',
                            name: file.name
                        }]);
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

    /**
     * Helper to save semantic memory
     */
    const saveToSemanticMemory = async (role: 'user' | 'model', content: string) => {
        if (!llmConfig.enableSemanticMemory || !llmConfig.embeddingModelId || !activeThreadId) return;

        try {
            const retriever = await getOrInitializeSemanticMemoryRetriever(llmConfig);
            if (retriever) {
                await retriever.saveMessage(activeThreadId, role, content);
            }
        } catch (err) {
            logger.log('warn', '[useChat] Failed to save semantic memory', err);
        }
    };

    const triggerAIResponse = useCallback((history: Message[]) => {
        runAgenticLoop(history);
    }, [runAgenticLoop]);

    const sendMessage = useCallback(async (textToSend: string, options?: { hidden?: boolean, role?: 'user' | 'system' }) => {
        if (!textToSend && pendingImages.length === 0 && pendingAudio.length === 0 && pendingFiles.length === 0) return;

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

        const newHistory = [...messages, userInput];
        // Save user message to semantic memory FIRST to prevent concurrent ONNX/LiteRT embedding calls
        await saveToSemanticMemory('user', textToSend);

        triggerAIResponse(newHistory);
    }, [pendingImages, pendingAudio, pendingFiles, messages, triggerAIResponse, setInput, llmConfig, activeThreadId]);

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
        pendingImages, removeImage, handleAttachImage,
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
