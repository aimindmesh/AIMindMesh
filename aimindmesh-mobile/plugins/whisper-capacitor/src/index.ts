import { registerPlugin } from '@capacitor/core';

import type { WhisperPlugin } from './definitions';

const Whisper = registerPlugin<WhisperPlugin>('Whisper', {
    web: () => import('./web').then(m => new m.WhisperWeb()),
});

export * from './definitions';
export { Whisper };
