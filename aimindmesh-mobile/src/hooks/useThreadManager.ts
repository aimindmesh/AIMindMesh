import { useState, useRef, useEffect, useCallback } from 'react';
import { logger } from '../services/logger';
import { createThread, saveThread, loadThread, getActiveThreadId, setActiveThreadId } from '../services/llm/threadManager';
import { Message } from '../types';

export function useThreadManager(
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
    setIsThreadListOpen: (val: boolean) => void
) {
    const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(null);
    const prevMessagesLength = useRef(0);

    // Sync active thread ID on mount - create new thread if none exists
    useEffect(() => {
        const initThread = () => {
            let id = getActiveThreadId();
            if (!id) {
                const thread = createThread([]);
                saveThread(thread);
                setActiveThreadId(thread.id);
                id = thread.id;
                logger.log('info', '[App] Created initial thread on first launch:', id);
            }
            setActiveThreadIdState(id);
        };
        initThread();
    }, []);

    // Provide a method to sync messages when chat.messages changes
    const syncMessages = useCallback((messages: Message[]) => {
        if (activeThreadIdState && messages.length !== prevMessagesLength.current) {
            const currentThread = loadThread(activeThreadIdState);
            if (currentThread) {
                currentThread.messages = messages;
                currentThread.updatedAt = new Date(); // Update timestamp
                saveThread(currentThread);
            }
            prevMessagesLength.current = messages.length;
        }
    }, [activeThreadIdState]);

    const handleNewConversation = useCallback(async (setMessages: (m: Message[]) => void) => {
        const thread = createThread([]); // Pass empty array
        setActiveThreadId(thread.id);
        setActiveThreadIdState(thread.id);
        setMessages([]);
        showToast('New conversation started', 'success');
    }, [showToast]);

    const handleSelectThread = useCallback((threadId: string, setMessages: (m: Message[]) => void) => {
        try {
            const hist = loadThread(threadId); // Sync
            if (hist) {
                setMessages(hist.messages); // Use .messages property
                setActiveThreadId(threadId);
                setActiveThreadIdState(threadId);
                setIsThreadListOpen(false);
            }
        } catch (e) {
            logger.log('error', 'Failed to load thread', e);
            showToast('Failed to load thread', 'error');
        }
    }, [showToast, setIsThreadListOpen]);

    const handleClearChat = useCallback((setMessages: (m: Message[]) => void) => {
        if (confirm('Are you sure you want to clear the chat history?')) {
            setMessages([]);
            if (activeThreadIdState) {
                const currentThread = loadThread(activeThreadIdState);
                if (currentThread) {
                    currentThread.messages = [];
                    saveThread(currentThread);
                }
            }
            showToast('Chat cleared', 'info');
        }
    }, [activeThreadIdState, showToast]);

    return {
        activeThreadIdState,
        setActiveThreadIdState,
        syncMessages,
        handleNewConversation,
        handleSelectThread,
        handleClearChat
    };
}
