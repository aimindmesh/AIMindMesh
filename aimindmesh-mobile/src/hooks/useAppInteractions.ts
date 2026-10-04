import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Personality } from '../types';
import { logger } from '../services/logger';
import { isDesktop } from '../utils/platform';
import { App as CapacitorApp } from '@capacitor/app';
import { runBackHandler } from '../services/native/backButtonRegistry';
import { ASSISTANT_LAUNCH_EVENT, OPEN_FEED_EVENT, consumeLaunchAction } from '../services/native/assistantLaunch';
import { isMeetingCaptureActive, VOICE_PAUSED_MESSAGE } from '../services/meeting/meetingCapture';

/** Back steps for screens App owns; each returns true when it handled the press */
export interface AppBackHandlers {
    /** Overlays above everything (tool confirmation, image studio) */
    closeOverlay: () => boolean;
    /** In-app navigation (feed thread, a tab other than chat) */
    navigateBack: () => boolean;
}

export const useAppInteractions = (backHandlersRef: React.MutableRefObject<AppBackHandlers | null>) => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isVoiceMode, setVoiceModeState] = useState(false);
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

    /**
     * Voice mode from anywhere (button, widget, shortcut, assistant gesture, wake word, call):
     * refused while a meeting is recording, which owns the microphone and live recognition.
     */
    const setIsVoiceMode = useCallback((value: React.SetStateAction<boolean>) => {
        setVoiceModeState(prev => {
            const next = typeof value === 'function' ? value(prev) : value;
            if (next && !prev && isMeetingCaptureActive()) {
                setTimeout(() => showToast(VOICE_PAUSED_MESSAGE, 'info'), 0);
                return prev;
            }
            return next;
        });
    }, [showToast]);

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

        // Assistant gesture / wake word session: MainActivity keeps the request until it is read,
        // so a cold start (event fired before this listener existed) is caught by the check below
        const openVoiceIfRequested = () => {
            consumeLaunchAction().then(action => {
                if (action === 'voice') {
                    logger.log('info', '[App] Opened as assistant: starting voice mode');
                    setIsVoiceMode(true);
                } else if (action?.startsWith('feed')) {
                    logger.log('info', '[App] Opened from a feed notification');
                    const insightId = action.split(':')[1];
                    window.dispatchEvent(new CustomEvent(OPEN_FEED_EVENT, { detail: insightId }));
                }
            });
        };

        window.addEventListener('widgetAction', handleWidgetAction);
        window.addEventListener('shortcutAction', handleShortcutAction);
        window.addEventListener(ASSISTANT_LAUNCH_EVENT, openVoiceIfRequested);
        openVoiceIfRequested();
        return () => {
            window.removeEventListener('widgetAction', handleWidgetAction);
            window.removeEventListener('shortcutAction', handleShortcutAction);
            window.removeEventListener(ASSISTANT_LAUNCH_EVENT, openVoiceIfRequested);
        };
    }, []);

    // --- Back Button Handling ---
    // Read by the listener registered once below (state of the last render)
    const backHandlerStateRef = useRef({
        isVoiceMode,
        incomingCall,
        isSettingsOpen,
        isThreadListOpen,
        isMeetingMode,
        isAgendaOpen,
        isTodoListOpen
    });
    backHandlerStateRef.current = {
        isVoiceMode,
        incomingCall,
        isSettingsOpen,
        isThreadListOpen,
        isMeetingMode,
        isAgendaOpen,
        isTodoListOpen
    };

    useEffect(() => {
        const handleBackButton = async () => {
            const state = backHandlerStateRef.current;
            const app = backHandlersRef.current;
            logger.log('debug', '[App] Back/Escape action, state:', state);

            if (state.incomingCall) {
                setIncomingCall(null);
            } else if (state.isVoiceMode) {
                setIsVoiceMode(false);
            } else if (app?.closeOverlay()) {
                // Tool confirmation (denied) or image studio closed
            } else if (state.isSettingsOpen) {
                setIsSettingsOpen(false);
            } else if (state.isThreadListOpen) {
                setIsThreadListOpen(false);
            } else if (state.isAgendaOpen) {
                setIsAgendaOpen(false);
            } else if (state.isTodoListOpen) {
                setIsTodoListOpen(false);
            } else if (state.isMeetingMode) {
                // Meeting mode closes itself when it registered a guarded close (active recording)
                if (runBackHandler('meeting') === undefined) setIsMeetingMode(false);
            } else if (app?.navigateBack()) {
                // Feed thread closed, or back to the chat tab
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
    }, [backHandlersRef]);

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
