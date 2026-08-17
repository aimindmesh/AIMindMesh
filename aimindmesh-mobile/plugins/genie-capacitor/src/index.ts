import { registerPlugin } from '@capacitor/core';
import type { GeniePlugin } from './definitions';

const Genie = registerPlugin<GeniePlugin>('Genie', {
  web: () => import('./web').then(m => new m.GenieWeb()),
});

export * from './definitions';
export { Genie };
