import { registerPlugin } from '@capacitor/core';

import type { SpeakerEmbeddingPlugin } from './definitions';

const SpeakerEmbedding = registerPlugin<SpeakerEmbeddingPlugin>('SpeakerEmbedding', {
    web: () => import('./web').then(m => new m.SpeakerEmbeddingWeb()),
});

export * from './definitions';
export { SpeakerEmbedding };
