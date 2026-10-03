import { registerPlugin } from '@capacitor/core';

import type { AudioOutputPlugin } from './definitions';

const AudioOutput = registerPlugin<AudioOutputPlugin>('AudioOutput', {
    web: () => import('./web').then(m => new m.AudioOutputWeb()),
});

export * from './definitions';
export { AudioOutput };
