import { WebPlugin } from '@capacitor/core';
import type { AudioOutputPlugin } from './definitions';

export class AudioOutputWeb extends WebPlugin implements AudioOutputPlugin {
    async setSpeakerphoneOn(options: { enabled: boolean }): Promise<void> {
        console.log('setSpeakerphoneOn called on web, not supported', options);
        // Web implementation would use WebRTC setSinkId if needed
        return Promise.resolve();
    }

    async getSpeakerphoneStatus(): Promise<{ enabled: boolean }> {
        console.log('getSpeakerphoneStatus called on web, not supported');
        return Promise.resolve({ enabled: false });
    }
}
