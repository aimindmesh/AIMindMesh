import { registerPlugin } from '@capacitor/core';
import type { LiteRTPlugin } from './definitions';

const LiteRT = registerPlugin<LiteRTPlugin>('LiteRT', {
    web: () => import('./web').then(m => new m.LiteRTWeb()),
});

export * from './definitions';
export { LiteRT };
