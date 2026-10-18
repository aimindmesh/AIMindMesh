import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const realConfig = path.join(root, 'src', 'config');
const fixtureConfig = path.join(root, 'test', 'fixtures', 'config.ts');

/**
 * src/config.ts reads config.json (live keys) at import time: every import of it
 * is redirected to an in-memory test configuration.
 */
const testConfigPlugin: Plugin = {
  name: 'aimindmesh-test-config',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || !source.startsWith('.')) return null;
    const target = path.resolve(path.dirname(importer), source).replace(/\.ts$/, '');
    return target === realConfig ? fixtureConfig : null;
  },
};

export default defineConfig({
  plugins: [testConfigPlugin],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    restoreMocks: true,
    unstubEnvs: true,
    env: {
      // Never touch the real operational database nor real services
      AIMINDMESH_DB_PATH: ':memory:',
      GITEA_URL: '',
      GITEA_TOKEN: '',
      OPENCLAW_URL: '',
      OPENCLAW_GATEWAY_TOKEN: '',
      HERMES_API_KEY: '',
      // The Anthropic SDK reads these when it gets no key: never a real credential in tests
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      // Venture git dirs and work trees: never under the server folder
      VENTURE_GIT_DIR: path.join(os.tmpdir(), 'aimindmesh-tests', 'ventures-git'),
      VENTURE_WORKSPACES_DIR: path.join(os.tmpdir(), 'aimindmesh-tests', 'ventures-work'),
      GIT_AUTHOR_NAME: 'aimindmesh-tests',
      GIT_AUTHOR_EMAIL: 'tests@aimindmesh.local',
      GIT_COMMITTER_NAME: 'aimindmesh-tests',
      GIT_COMMITTER_EMAIL: 'tests@aimindmesh.local',
    },
  },
});
