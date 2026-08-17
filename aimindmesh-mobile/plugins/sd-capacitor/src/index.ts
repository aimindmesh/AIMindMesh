import { registerPlugin } from '@capacitor/core';
import type { SDPlugin } from './definitions';

const SD = registerPlugin<SDPlugin>('SD', {
  web: () => import('./web').then(m => new m.SDWeb()),
});

export * from './definitions';
export { SD };
