/**
 * Whether a meeting is using the microphone right now (recording, paused included). While it
 * is, the voice assistant and the wake word stay off: one microphone, and live Vosk belongs to
 * the meeting.
 */

type Listener = (active: boolean) => void;

let active = false;
const listeners = new Set<Listener>();

export function isMeetingCaptureActive(): boolean {
    return active;
}

export function setMeetingCaptureActive(value: boolean): void {
    if (active === value) return;
    active = value;
    listeners.forEach(listener => listener(value));
}

export function onMeetingCaptureChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Message shown when the voice assistant is asked for during a recording. */
export const VOICE_PAUSED_MESSAGE = 'The voice assistant is paused while a meeting is recorded';
