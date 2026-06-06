import { registerPlugin } from '@capacitor/core';
import type { AndroidAutoPlugin } from './definitions';

const AndroidAuto = registerPlugin<AndroidAutoPlugin>('AndroidAuto', {
    web: () => import('./web').then(m => new m.AndroidAutoWeb()),
});

export * from './definitions';
export { AndroidAuto };
