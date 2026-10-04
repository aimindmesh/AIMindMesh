import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { MeetingRecorder } from '../../services/audio/meetingRecorder';
import { logger } from '../../services/logger';

/**
 * A recording that outlived its screen (Activity or WebView recreated while the recording
 * service kept going): checked at launch and on resume, and reported so the app opens the
 * meeting screen, which re-attaches to it.
 */
export function useMeetingPresence(meetingMounted: boolean, onOrphanRecording: () => void): void {
    const mountedRef = useRef(meetingMounted);
    mountedRef.current = meetingMounted;
    const callbackRef = useRef(onOrphanRecording);
    callbackRef.current = onOrphanRecording;

    useEffect(() => {
        const check = async () => {
            if (mountedRef.current) return;
            const status = await MeetingRecorder.getStatus().catch(() => null);
            if (!status || status.state === 'idle' || !status.sessionId || mountedRef.current) return;
            logger.log('info', `Recording ${status.sessionId} running without its screen: reopening it`);
            callbackRef.current();
        };
        void check();
        const handle = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void check(); });
        return () => { handle.then(h => h.remove()).catch(() => { }); };
    }, []);
}
