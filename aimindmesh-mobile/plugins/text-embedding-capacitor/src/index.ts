import { registerPlugin } from '@capacitor/core';

import type { TextEmbeddingPlugin } from './definitions';

const TextEmbedding = registerPlugin<TextEmbeddingPlugin>('TextEmbedding', {
    web: () => import('./web').then(m => new m.TextEmbeddingWeb()),
});

export * from './definitions';
export { TextEmbedding };
