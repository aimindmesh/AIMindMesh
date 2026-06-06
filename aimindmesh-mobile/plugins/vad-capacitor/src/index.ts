import { registerPlugin } from '@capacitor/core';

import type { VADPlugin } from './definitions';

const VAD = registerPlugin<VADPlugin>('VAD', {
    web: () => import('./web').then(m => new m.VADWeb()),
});

export * from './definitions';
export { VAD };
