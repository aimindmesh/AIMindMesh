import { registerPlugin } from '@capacitor/core';

export interface AudioOutputPlugin {
    /**
     * Set speaker phone on or off
     * @param options - { enabled: boolean }
     */
    setSpeakerphoneOn(options: { enabled: boolean }): Promise<void>;

    /**
     * Get current speakerphone status
     * @returns { enabled: boolean }
     */
    getSpeakerphoneStatus(): Promise<{ enabled: boolean }>;
}

const AudioOutput = registerPlugin<AudioOutputPlugin>('AudioOutput', {
    web: () => import('./web').then(m => new m.AudioOutputWeb()),
});

export * from './definitions';
export { AudioOutput };
