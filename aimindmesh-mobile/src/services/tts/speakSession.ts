/**
 * End-callback bookkeeping for speak()/stopSpeaking().
 *
 * Callers flip isSpeaking back in speak()'s onEnd. Stopped Piper/Kokoro replies never reach
 * their own end, so an external stop (stop button, app to background, hang-up) must report
 * it, or the UI stays on "Speaking...". A reply replaced by a newer speak() must instead stay
 * silent: its late end would reset isSpeaking while the new reply is playing.
 */
let generation = 0;
let pendingEnd: (() => void) | null = null;

/** Registers the end callback of a new reply (superseding any previous one); returns a run-once wrapper. */
export function beginSpeak(onEnd?: () => void): (() => void) | undefined {
    const gen = ++generation;
    if (!onEnd) {
        pendingEnd = null;
        return undefined;
    }
    let done = false;
    const finish = () => {
        if (done || gen !== generation) return;
        done = true;
        pendingEnd = null;
        onEnd();
    };
    pendingEnd = finish;
    return finish;
}

/** Reports the end of the current reply after an external stop. */
export function endPendingSpeak(): void {
    const finish = pendingEnd;
    pendingEnd = null;
    finish?.();
}
