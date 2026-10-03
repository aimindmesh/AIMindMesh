import { useState, useRef, useEffect, useCallback } from 'react';
import { logger } from '../services/logger';
import { createThread, saveThread, saveThreadMessages, loadThread, getActiveThreadId, setActiveThreadId } from '../services/llm/threadManager';
import { Message } from '../types';

export function useThreadManager(
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
    setIsThreadListOpen: (val: boolean) => void
) {
    const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(null);
    const prevMessagesLength = useRef(0);
    const savedSignature = useRef('');
    const pendingSave = useRef<(() => void) | null>(null);
    const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // A save scheduled while streaming is written right away when the app closes the chat
    useEffect(() => () => {
        clearTimeout(pendingTimer.current);
        pendingSave.current?.();
    }, []);

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

    // Provide a method to sync messages when chat.messages changes.
    // A new message is saved at once; a message that is still changing (streaming) is saved
    // once its text stops changing, so the final answer is stored without a write per token.
    const syncMessages = useCallback((messages: Message[]) => {
        if (!activeThreadIdState) return;
        const last = messages[messages.length - 1];
        const signature = `${activeThreadIdState}:${messages.length}:${last?.id ?? ''}:${last?.text?.length ?? 0}:${last?.thinking?.length ?? 0}`;
        if (signature === savedSignature.current) return;

        const threadId = activeThreadIdState;
        const save = () => {
            pendingSave.current = null;
            // Creates the thread if missing: a new conversation is stored with its first message
            if (saveThreadMessages(threadId, messages)) {
                savedSignature.current = signature;
            } else {
                showToast('Storage full: this conversation could not be saved', 'error');
            }
        };

        clearTimeout(pendingTimer.current);
        if (messages.length !== prevMessagesLength.current) {
            prevMessagesLength.current = messages.length;
            save();
        } else {
            pendingSave.current = save;
            pendingTimer.current = setTimeout(save, 800);
        }
    }, [activeThreadIdState, showToast]);

    const handleNewConversation = useCallback(async (setMessages: (m: Message[]) => void) => {
        // The previous conversation is written now, not when its pending debounced save fires
        clearTimeout(pendingTimer.current);
        pendingSave.current?.();
        // Stored by syncMessages with its first message (no empty threads in the list)
        const thread = createThread([]);
        setActiveThreadId(thread.id);
        setActiveThreadIdState(thread.id);
        setMessages([]);
        showToast('New conversation started', 'success');
    }, [showToast]);

    const handleSelectThread = useCallback((threadId: string, setMessages: (m: Message[]) => void) => {
        clearTimeout(pendingTimer.current);
        pendingSave.current?.();
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
