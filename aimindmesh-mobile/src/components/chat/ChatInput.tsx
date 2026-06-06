import { useRef, useEffect } from 'react';
import { MicrophoneIcon, PhotoIcon, SendIcon, PaperClipIcon } from '../../constants';
import { ImageAttachment, AudioAttachment, FileAttachment, Personality } from '../../types';
import { triggerHaptic } from '../../services/native';
import { useWindowSize } from '../../hooks/useWindowSize';

interface ChatInputProps {
    input: string;
    setInput: (value: string) => void;
    isLoading: boolean;
    isNativeLLMLoading: boolean;
    personality: Personality;
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
    onRemoveImage: (index: number) => void;
    onRemoveAudio: (index: number) => void;
    onRemoveFile: (index: number) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
    input,
    setInput,
    isLoading,
    isNativeLLMLoading,
    personality,
    isInputDisabled,
    onSendMessage,
    onStopGeneration,
    onAttachImage,
    onAttachAudio,
    onAttachFile,
    onVoiceMode,
    pendingImages,
    pendingAudio,
    pendingFiles,
    onRemoveImage,
    onRemoveAudio,
    onRemoveFile
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { width } = useWindowSize();
    const isNarrow = width < 500;

    useEffect(() => {
        if (!isInputDisabled && !isLoading) {
            inputRef.current?.focus();
        }
    }, [isInputDisabled, isLoading]);

    return (
        <footer className={`p-3 backdrop-blur-md bg-surface/40 border-t border-white/5 sticky bottom-0 z-10 transition-all duration-300 ${isNarrow ? 'px-2 pb-2' : ''}`}>
            {/* Image Preview Section */}
            {pendingImages.length > 0 && (
                <div className="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10">
                    {pendingImages.map((img, idx) => (
                        <div key={idx} className="relative flex-shrink-0 group">
                            <img
                                src={img.webPath || (img.base64 ? `data:${img.mimeType};base64,${img.base64}` : '')}
                                className="w-16 h-16 object-cover rounded-lg border border-white/10 shadow-sm"
                                alt={img.name || `Image ${idx + 1}`}
                            />
                            <button
                                type="button"
                                onClick={() => onRemoveImage(idx)}
                                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-600 transition-colors shadow-sm"
                                aria-label="Remove image"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Audio Preview Section */}
            {pendingAudio.length > 0 && (
                <div className="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10">
                    {pendingAudio.map((aud, idx) => (
                        <div key={idx} className="relative flex-shrink-0 bg-surface/60 p-2 rounded-lg border border-white/10 flex items-center gap-2 max-w-[200px] shadow-sm">
                            <div className="text-xl">🎵</div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-text-primary truncate font-medium">{aud.name}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveAudio(idx)}
                                className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-600 transition-colors flex-shrink-0 ml-1"
                                aria-label="Remove audio"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* File Preview Section */}
            {pendingFiles.length > 0 && (
                <div className="flex gap-2 mb-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/10">
                    {pendingFiles.map((file, idx) => (
                        <div key={idx} className="relative flex-shrink-0 bg-surface/60 p-2 rounded-lg border border-white/10 flex items-center gap-2 max-w-[200px] shadow-sm">
                            <div className="text-xl text-blue-400">📄</div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-text-primary truncate font-medium">{file.name}</p>
                                <p className="text-[10px] text-text-secondary truncate">{Math.round(file.content.length / 1024 * 10) / 10} KB</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveFile(idx)}
                                className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-red-600 transition-colors flex-shrink-0 ml-1"
                                aria-label="Remove file"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Standard Chat Input */}
            <form onSubmit={onSendMessage} className="flex flex-col md:flex-row w-full gap-2">
                <div className={`flex ${isNarrow ? 'gap-1' : 'gap-2'} w-full md:w-auto justify-start items-center`}>
                    <button
                        type="button"
                        onClick={() => { onVoiceMode(); triggerHaptic(); }}
                        className="p-2 text-primary hover:text-primary/80 transition-colors rounded-full hover:bg-white/5 active:bg-white/10"
                        aria-label="Voice Call"
                        disabled={isInputDisabled}
                    >
                        <MicrophoneIcon className={isNarrow ? 'w-6 h-6' : 'w-7 h-7'} />
                    </button>
                    <button
                        type="button"
                        onClick={onAttachImage}
                        className="p-2 text-primary hover:text-primary/80 transition-colors rounded-full hover:bg-white/5 active:bg-white/10"
                        aria-label="Attach image"
                        disabled={isInputDisabled}
                    >
                        <PhotoIcon className={isNarrow ? 'w-6 h-6' : 'w-7 h-7'} />
                    </button>
                    <button
                        type="button"
                        onClick={onAttachAudio}
                        className="p-2 text-primary hover:text-primary/80 transition-colors rounded-full hover:bg-white/5 active:bg-white/10"
                        aria-label="Attach audio"
                        disabled={isInputDisabled}
                    >
                        <svg className={isNarrow ? 'w-6 h-6' : 'w-7 h-7'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={onAttachFile}
                        className="p-2 text-primary hover:text-primary/80 transition-colors rounded-full hover:bg-white/5 active:bg-white/10"
                        aria-label="Attach file"
                        disabled={isInputDisabled}
                    >
                        <PaperClipIcon className={isNarrow ? 'w-6 h-6' : 'w-7 h-7'} />
                    </button>
                </div>

                <div className="flex gap-2 flex-1 w-full items-center">
                    <div className="flex-1 relative">
                        <input
                            ref={inputRef}
                            type="text"
                            name="chat-message"
                            id="chat-message-input"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={isNativeLLMLoading ? 'Loading AI model...' : `Message ${personality.name}...`}
                            className={`w-full bg-input text-text-primary placeholder-text-secondary/60 rounded-full pl-4 pr-10 ${isNarrow ? 'py-2 text-sm' : 'py-3'} border border-white/5 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all shadow-inner disabled:opacity-50 disabled:cursor-not-allowed`}
                            disabled={isInputDisabled}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    onSendMessage(e);
                                }
                            }}
                        />
                    </div>
                    {isLoading ? (
                        <button
                            type="button"
                            onClick={onStopGeneration}
                            className="p-2 bg-red-600 rounded-full hover:bg-red-700 transition-colors flex-shrink-0 animate-pulse"
                            aria-label="Stop generation"
                        >
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <rect x="6" y="6" width="12" height="12" fill="currentColor" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={isInputDisabled || (!input.trim() && pendingImages.length === 0 && pendingAudio.length === 0 && pendingFiles.length === 0)}
                            className="p-2 bg-primary rounded-full hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 shadow-lg"
                            aria-label="Send message"
                        >
                            <SendIcon className="w-6 h-6" />
                        </button>
                    )}
                </div>
            </form>
        </footer>
    );
};
