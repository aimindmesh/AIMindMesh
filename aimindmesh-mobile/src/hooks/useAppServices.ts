import { useEffect, useRef } from 'react';
import { Message } from '../types';
import { logger } from '../services/logger';
import { proactiveService } from '../services/proactive/ProactiveService';
import { backgroundServicePlugin } from '../services/proactive/BackgroundServicePlugin';
import { consolidationScheduler } from '../services/memory/facts/consolidationScheduler';

/** The proactive checks also read what the memory has not consolidated yet (once per app run) */
let checkListenerAdded = false;

/**
 * Background services of the app: the proactive engine, and the memory consolidation that
 * reads each conversation once the chat is quiet (any provider, on-device ones included).
 */
export const useAppServices = (
    chat: { isLoading: boolean; messages: Message[] },
    activeThreadId: string | null
) => {
    // --- Proactive Service Init ---
    useEffect(() => {
        proactiveService.init().catch(err => logger.log('error', 'Failed to init proactive service', err));
        if (!checkListenerAdded) {
            checkListenerAdded = true;
            backgroundServicePlugin.addListener(() => consolidationScheduler.run('proactive check'));
        }
    }, []);

    // --- Memory consolidation: an answer completed, read the conversation when the chat is quiet ---
    const wasLoading = useRef(chat.isLoading);
    useEffect(() => {
        const finished = wasLoading.current && !chat.isLoading;
        wasLoading.current = chat.isLoading;
        if (!finished || chat.messages.length < 2) return;
        const last = chat.messages[chat.messages.length - 1];
        if (last.role === 'model' && last.text) consolidationScheduler.note(activeThreadId, chat.messages);
    }, [chat.isLoading, chat.messages, activeThreadId]);
};
