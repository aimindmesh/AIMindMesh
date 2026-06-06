import { registerPlugin } from '@capacitor/core';

import type { PiperPlugin } from './definitions';

const Piper = registerPlugin<PiperPlugin>('Piper', {
    web: () => import('./web').then(m => new m.PiperWeb()),
});

export * from './definitions';
export { Piper };
