import React from 'react';
import { Personality, Message } from '../../types';
import { UsersIcon, TrashIcon } from '../../constants';
import { triggerHaptic } from '../../services/native';
import { WorkspaceSelector } from '../workspaces/WorkspaceSelector';
import { useWindowSize } from '../../hooks/useWindowSize';

interface ChatHeaderProps {
    personality: Personality;
    messages: Message[];
    onOpenThreads: () => void;
    onNewChat: () => void;
    onOpenTodo: () => void;
    onOpenAgenda: () => void;
    onOpenMeeting: () => void;
    onOpenSettings: () => void;
    onClearChat: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
    personality,
    messages,
    onOpenThreads,
    onNewChat,
    onOpenTodo,
    onOpenAgenda,
    onOpenMeeting,
    onOpenSettings,
    onClearChat
}) => {
    const { width } = useWindowSize();
    const isNarrow = width < 500;

    return (
        <header className={`flex flex-col bg-surface border-b border-white/10 shadow-xl z-20 sticky top-0 backdrop-blur-md bg-opacity-90 transition-all duration-300`}>
            <div className="flex justify-between items-center p-3 py-2 w-full">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => { onOpenThreads(); triggerHaptic(); }}
                        className="flex items-center gap-2 text-text-primary hover:text-primary transition-colors px-3 py-2 rounded-lg hover:bg-white/5 active:bg-white/10"
                        aria-label="Conversations"
                        title="View conversations"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <span className="text-sm font-medium hidden sm:inline">Conversations</span>
                    </button>
                    {!isNarrow && (
                        <button
                            onClick={() => { onNewChat(); triggerHaptic(); }}
                            className="text-text-secondary hover:text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                            aria-label="New chat"
                            title="New chat"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    )}
                </div>

                {!isNarrow && (
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                        <span className="text-primary font-bold text-lg hidden sm:inline drop-shadow-sm">{personality.name}</span>
                        <div className="h-4 w-px bg-white/20 mx-1 hidden sm:block"></div>
                        <div className="pointer-events-auto">
                            <WorkspaceSelector className="justify-center" />
                        </div>
                    </div>
                )}

                {isNarrow && (
                    <div className="flex items-center gap-1">
                        <span className="text-primary font-bold text-base drop-shadow-sm mr-2">{personality.name}</span>
                    </div>
                )}

                <div className="flex gap-1 items-center">
                    {isNarrow && (
                        <button
                            onClick={() => { onNewChat(); triggerHaptic(); }}
                            className="text-text-secondary hover:text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                            aria-label="New chat"
                            title="New chat"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                        </button>
                    )}
                    <button
                        onClick={() => { onOpenTodo(); triggerHaptic(); }}
                        className="text-text-secondary hover:text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                        title="To-Do List"
                        aria-label="To-Do List"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                    </button>
                    <button
                        onClick={() => { onOpenAgenda(); triggerHaptic(); }}
                        className="text-text-secondary hover:text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                        title="Agenda"
                        aria-label="Agenda"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </button>
                    {!isNarrow && (
                        <button
                            onClick={() => { onOpenMeeting(); triggerHaptic(); }}
                            className="text-text-secondary hover:text-primary p-2 rounded-full hover:bg-white/10 transition-colors"
                            title="Meeting Assistant"
                            aria-label="Meeting Assistant"
                        >
                            <UsersIcon className="w-6 h-6" />
                        </button>
                    )}
                    <button
                        onClick={() => { onOpenSettings(); triggerHaptic(); }}
                        className="text-text-secondary hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Settings"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                    {messages.length > 0 && (
                        <button
                            onClick={onClearChat}
                            className="text-text-secondary hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
                            aria-label="Clear chat"
                            title="Clear conversation"
                        >
                            <TrashIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                    )}
                </div>
            </div>

            {isNarrow && (
                <div className="flex justify-center items-center pb-2 px-3 border-t border-white/5 pt-1 bg-white/5 backdrop-blur-sm">
                    <WorkspaceSelector className="w-full justify-center" />
                </div>
            )}
        </header>
    );
};
