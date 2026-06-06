import React, { useRef, useEffect } from 'react';
import { Message, Personality } from '../../types';
import MessageBubble from './MessageBubble';
import TypingIndicator from '../ui/TypingIndicator';

interface ChatMessagesProps {
    messages: Message[];
    personality: Personality;
    isLoading: boolean;
    onResend: (message: Message) => void;
    onRegenerate: (message: Message) => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
    messages,
    personality,
    isLoading,
    onResend,
    onRegenerate,
}) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    return (
        <div className="flex-1 overflow-y-auto p-4 relative z-0">
            <div className="space-y-6">
                {messages.length === 0 && (
                    <div className="text-center text-text-secondary text-sm mt-10 opacity-50">
                        <p>Start chatting with {personality.name}!</p>
                    </div>
                )}
                {messages.filter(m => !m.hidden).map((message) => (
                    <MessageBubble
                        key={message.id}
                        message={message}
                        onResend={onResend}
                        onRegenerate={onRegenerate}
                    />
                ))}
                {isLoading && <TypingIndicator />}
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
};
