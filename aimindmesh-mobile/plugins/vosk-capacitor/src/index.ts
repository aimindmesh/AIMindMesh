import { registerPlugin } from '@capacitor/core';

import type { VoskPlugin } from './definitions';

const Vosk = registerPlugin<VoskPlugin>('Vosk', {
    web: () => import('./web').then(m => new m.VoskWeb()),
});

export * from './definitions';
export { Vosk };
