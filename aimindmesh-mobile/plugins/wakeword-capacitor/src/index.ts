import { registerPlugin } from '@capacitor/core';

import type { OpenWakeWordPlugin } from './definitions';

const OpenWakeWord = registerPlugin<OpenWakeWordPlugin>('OpenWakeWord', {
  web: () => import('./web').then(m => new m.OpenWakeWordWeb()),
});

export * from './definitions';
export { OpenWakeWord };