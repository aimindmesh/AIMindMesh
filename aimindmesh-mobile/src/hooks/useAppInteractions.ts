import { useState, useCallback, useRef, useEffect } from 'react';
import { Personality } from '../types';
import { logger } from '../services/logger';
import { isDesktop } from '../utils/platform';
import { App as CapacitorApp } from '@capacitor/app';

export const useAppInteractions = (chat: any) => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [isProactiveThinking, setIsProactiveThinking] = useState(false);
    const [incomingCall, setIncomingCall] = useState<Personality | null>(null);
    const [isThreadListOpen, setIsThreadListOpen] = useState(false);
    const [isMeetingMode, setIsMeetingMode] = useState(false);
    const [isAgendaOpen, setIsAgendaOpen] = useState(false);
    const [isTodoListOpen, setIsTodoListOpen] = useState(false);
    const [initialView, setInitialView] = useState<string | undefined>(undefined);
    const [toast, setToast] = useState<{ message: string; isVisible: boolean; type: 'success' | 'error' | 'info' }>({ message: '', isVisible: false, type: 'success' });
    const [justAcceptedCall, setJustAcceptedCall] = useState(false);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, isVisible: true, type });
    }, []);

    const hideToast = useCallback(() => setToast(prev => ({ ...prev, isVisible: false })), []);

    // --- Interaction Handlers ---
    useEffect(() => {
        const handleWidgetAction = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            const action = customEvent.detail;
            logger.log('info', `[App] Widget action received: ${action}`);

            if (action === 'call-mode') {
                setIsVoiceMode(true);
            } else if (action === 'message-mode') {
                setIsSettingsOpen(false);
                setIsAgendaOpen(false);
                setIsTodoListOpen(false);
                setIsMeetingMode(false);
                setIsThreadListOpen(false);
            }
        };

        const handleShortcutAction = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            const route = customEvent.detail;
            logger.log('info', `[App] Shortcut action received: ${route}`);

            if (route === 'call') {
                setIsVoiceMode(true);
            } else if (route === 'agenda') {
                setInitialView(undefined);
                setIsAgendaOpen(true);
            } else if (route === 'kanban') {
                setInitialView('kanban');
                setIsAgendaOpen(true);
            }
        };

        window.addEventListener('widgetAction', handleWidgetAction);
        window.addEventListener('shortcutAction', handleShortcutAction);
        return () => {
            window.removeEventListener('widgetAction', handleWidgetAction);
            window.removeEventListener('shortcutAction', handleShortcutAction);
        };
    }, []);

    // --- Back Button Handling ---
    const backHandlerStateRef = useRef({
        isVoiceMode,
        incomingCall,
        isSettingsOpen,
        isThreadListOpen,
        isMeetingMode,
        isAgendaOpen,
        isTodoListOpen,
        pendingToolCall: chat.pendingToolCall
    });

    useEffect(() => {
        backHandlerStateRef.current = {
            isVoiceMode,
            incomingCall,
            isSettingsOpen,
            isThreadListOpen,
            isMeetingMode,
            isAgendaOpen,
            isTodoListOpen,
            pendingToolCall: chat.pendingToolCall
        };
    }, [isVoiceMode, incomingCall, isSettingsOpen, isThreadListOpen, isMeetingMode, isAgendaOpen, isTodoListOpen, chat.pendingToolCall]);

    useEffect(() => {
        const handleBackButton = async () => {
            const state = backHandlerStateRef.current;
            logger.log('debug', '[App] Back/Escape action, state:', state);

            if (state.incomingCall) {
                setIncomingCall(null);
            } else if (state.isVoiceMode) {
                setIsVoiceMode(false);
            } else if (state.pendingToolCall) {
                chat.handleConfirmTool(false, false);
            } else if (state.isSettingsOpen) {
                setIsSettingsOpen(false);
            } else if (state.isThreadListOpen) {
                setIsThreadListOpen(false);
            } else if (state.isAgendaOpen) {
                setIsAgendaOpen(false);
            } else if (state.isTodoListOpen) {
                setIsTodoListOpen(false);
            } else if (state.isMeetingMode) {
                setIsMeetingMode(false);
            } else if (!isDesktop()) {
                CapacitorApp.exitApp();
            }
        };

        if (isDesktop()) {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    handleBackButton();
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        } else {
            const listener = CapacitorApp.addListener('backButton', handleBackButton);
            return () => {
                listener.then(handle => handle.remove());
            };
        }
    }, [chat]);

    return {
        isSettingsOpen, setIsSettingsOpen,
        isVoiceMode, setIsVoiceMode,
        isProactiveThinking, setIsProactiveThinking,
        incomingCall, setIncomingCall,
        isThreadListOpen, setIsThreadListOpen,
        isMeetingMode, setIsMeetingMode,
        isAgendaOpen, setIsAgendaOpen,
        isTodoListOpen, setIsTodoListOpen,
        initialView, setInitialView,
        toast, showToast, hideToast,
        justAcceptedCall, setJustAcceptedCall
    };
};
