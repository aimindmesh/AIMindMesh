import React from 'react';
import { ChatHeader } from './ChatHeader';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { Message, Personality, ImageAttachment, AudioAttachment, FileAttachment } from '../../types';

interface ChatAreaProps {
    messages: Message[];
    personality: Personality;
    isLoading: boolean;
    isNativeLLMLoading: boolean;
    input: string;
    setInput: (val: string) => void;
    isInputDisabled: boolean;
    onSendMessage: (e?: React.FormEvent) => void;
    onStopGeneration: () => void;
    onAttachImage: () => void;
    onAttachAudio: () => void;
    onAttachFile: () => void;
    onVoiceMode: () => void;
    pendingImages: ImageAttachment[];
    pendingAudio: AudioAttachment[];
    pendingFiles: FileAttachment[];
    onRemoveImage: (idx: number) => void;
    onRemoveAudio: (idx: number) => void;
    onRemoveFile: (idx: number) => void;
    onResend: (msg: Message) => void;
    onRegenerate: (msg: Message) => void;

    // Header Actions
    onOpenThreads: () => void;
    onNewChat: () => void;
    onOpenTodo: () => void;
    onOpenAgenda: () => void;
    onOpenMeeting: () => void;
    onOpenSettings: () => void;
    onClearChat: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = (props) => {
    return (
        <div className="h-full w-full bg-app-gradient text-text-primary font-sans flex flex-col overflow-hidden">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 left-0 w-full h-64 bg-primary/10 blur-3xl pointer-events-none" />

            {/* Model Loading Overlay */}
            {props.isNativeLLMLoading && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-surface/90 border border-white/10 rounded-2xl p-6 mx-4 max-w-sm w-full text-center shadow-2xl">
                        {/* Spinner */}
                        <div className="flex justify-center mb-4">
                            <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                        </div>
                        {/* Loading Text */}
                        <h3 className="text-lg font-semibold text-text-primary mb-2">
                            Loading AI Model<span className="animate-pulse">...</span>
                        </h3>
                        <p className="text-sm text-text-secondary">
                            Please wait while the model is being initialized. This may take a moment.
                        </p>
                    </div>
                </div>
            )}

            <ChatHeader
                personality={props.personality}
                messages={props.messages}
                onOpenThreads={props.onOpenThreads}
                onNewChat={props.onNewChat}
                onOpenTodo={props.onOpenTodo}
                onOpenAgenda={props.onOpenAgenda}
                onOpenMeeting={props.onOpenMeeting}
                onOpenSettings={props.onOpenSettings}
                onClearChat={props.onClearChat}
            />

            <ChatMessages
                messages={props.messages}
                personality={props.personality}
                isLoading={props.isLoading}
                onResend={props.onResend}
                onRegenerate={props.onRegenerate}
            />

            <ChatInput
                input={props.input}
                setInput={props.setInput}
                isLoading={props.isLoading}
                isNativeLLMLoading={props.isNativeLLMLoading}
                personality={props.personality}
                isInputDisabled={props.isInputDisabled}
                onSendMessage={props.onSendMessage}
                onStopGeneration={props.onStopGeneration}
                onAttachImage={props.onAttachImage}
                onAttachAudio={props.onAttachAudio}
                onAttachFile={props.onAttachFile}
                onVoiceMode={props.onVoiceMode}
                pendingImages={props.pendingImages}
                pendingAudio={props.pendingAudio}
                pendingFiles={props.pendingFiles}
                onRemoveImage={props.onRemoveImage}
                onRemoveAudio={props.onRemoveAudio}
                onRemoveFile={props.onRemoveFile}
            />
        </div>
    );
};
