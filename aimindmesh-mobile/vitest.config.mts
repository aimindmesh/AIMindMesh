import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Unit tests of the app's pure logic (no device, no native plugins: tests mock them).
 * Same module aliases as the app build.
 */
export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
  },
}));
