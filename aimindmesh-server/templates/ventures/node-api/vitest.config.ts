import { defineConfig } from 'vitest/config';

// Owned by the platform: restored before every validation
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'acceptance/**/*.test.ts'],
  },
});
