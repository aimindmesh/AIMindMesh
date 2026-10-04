import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Evaluation harness (eval/): the app's real prompt, memory and tool code against a local
 * llama-server running the same GGUF models as the phone. Not part of `npm test`:
 *   scripts/eval/build-llama-server.sh, then start llama-server, then `npm run eval`.
 */
export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
}));
