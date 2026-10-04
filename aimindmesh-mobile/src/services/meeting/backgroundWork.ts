import { registerPlugin } from '@capacitor/core';

export type BackgroundWorkKind = 'transcribe' | 'speakers';

interface BackgroundWorkPlugin {
    /** Foreground service + wake lock, so processing goes on with the screen off. */
    start(options: { kind: BackgroundWorkKind }): Promise<void>;
    progress(options: { kind: BackgroundWorkKind; percent: number }): Promise<void>;
    stop(): Promise<void>;
}

/** Android: recording/BackgroundWorkPlugin. Every call is best effort. */
export const BackgroundWork = registerPlugin<BackgroundWorkPlugin>('BackgroundWork');
