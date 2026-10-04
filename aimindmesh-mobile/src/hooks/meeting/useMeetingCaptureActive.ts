import { useSyncExternalStore } from 'react';
import { isMeetingCaptureActive, onMeetingCaptureChange } from '../../services/meeting/meetingCapture';

/** True while a meeting is recording (see meetingCapture). */
export function useMeetingCaptureActive(): boolean {
    return useSyncExternalStore(onMeetingCaptureChange, isMeetingCaptureActive, isMeetingCaptureActive);
}
