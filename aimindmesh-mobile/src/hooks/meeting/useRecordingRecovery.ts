import { useCallback, useEffect, useRef, useState } from 'react';
import { MeetingRecorder, RecoverableSession } from '../../services/audio/meetingRecorder';
import {
    describeRecoveredRecording,
    recoverInterruptedRecordingsDetailed,
    RecoveredRecording,
    retryRecoverSession
} from '../../services/meeting/recordingRecovery';
import { logger } from '../../services/logger';
import { askConfirm } from '../../services/ui/dialogs';

interface Options {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** Shows a recovered meeting, unless the screen is busy with another one. */
    onRecovered: (recording: RecoveredRecording) => void;
}

/**
 * Recordings that a crash or a kill left unsaved are recovered automatically when the meeting
 * screen opens (into their meeting, with their marks); the few that can't be saved now are
 * listed, to retry or discard.
 */
export function useRecordingRecovery({ showToast, onRecovered }: Options) {
    const [failed, setFailed] = useState<RecoverableSession[]>([]);
    const [busySessionId, setBusySessionId] = useState<string | null>(null);
    const callbacksRef = useRef({ showToast, onRecovered });
    callbacksRef.current = { showToast, onRecovered };

    useEffect(() => {
        let cancelled = false;
        recoverInterruptedRecordingsDetailed()
            .then(({ recovered, failed: notSaved }) => {
                if (cancelled) return;
                setFailed(notSaved);
                if (recovered.length === 0) return;
                callbacksRef.current.showToast(recovered.map(r => describeRecoveredRecording(r)).join('\n'), 'success');
                if (recovered.length === 1) callbacksRef.current.onRecovered(recovered[0]);
            })
            .catch(e => logger.log('warn', 'Recovery of interrupted recordings failed', e));
        return () => { cancelled = true; };
    }, []);

    const recover = useCallback(async (session: RecoverableSession) => {
        setBusySessionId(session.sessionId);
        try {
            const recovered = await retryRecoverSession(session);
            setFailed(list => list.filter(s => s.sessionId !== session.sessionId));
            if (recovered) {
                callbacksRef.current.showToast(describeRecoveredRecording(recovered), 'success');
                callbacksRef.current.onRecovered(recovered);
            }
        } catch (e: any) {
            logger.log('error', 'Recovery failed', e);
            callbacksRef.current.showToast(`Recovery failed: ${e?.message || e}`, 'error');
        } finally {
            setBusySessionId(null);
        }
    }, []);

    const discard = useCallback(async (session: RecoverableSession) => {
        const ok = await askConfirm({
            title: 'Delete this interrupted recording?',
            message: 'Its audio cannot be recovered afterwards.',
            confirmLabel: 'Delete',
            danger: true
        });
        if (!ok) return;
        try {
            await MeetingRecorder.discard({ sessionId: session.sessionId });
            setFailed(list => list.filter(s => s.sessionId !== session.sessionId));
        } catch (e) {
            logger.log('error', 'Discard failed', e);
        }
    }, []);

    return { recoverable: failed, busySessionId, recover, discard };
}
