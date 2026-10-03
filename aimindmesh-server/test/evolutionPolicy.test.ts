import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { config, SERVER_ROOT } from './fixtures/config';
import db from '../src/db/sqlite';

// Layout with a .noautoedit in the parent of repoLocalPath (as on a dev checkout).
// Set before the policy is first used: it caches .noautoedit and the DB prefixes for a few seconds.
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-test-'));
fs.mkdirSync(path.join(tmpRepo, 'aimindmesh-server'));
fs.writeFileSync(path.join(tmpRepo, '.noautoedit'),
  '# test\naimindmesh-server/src/services/KGManager.ts\naimindmesh-server/src/services/research/\n');
(config.autoEvolution as any).repoLocalPath = path.join(tmpRepo, 'aimindmesh-server');
db.prepare(`INSERT INTO protected_paths (path, reason, added_at) VALUES (?, 'test', 0)`).run('aimindmesh-server/src/services/Wiki_Synth');
db.prepare(`INSERT INTO protected_paths (path, reason, added_at) VALUES (?, 'test', 0)`).run('aimindmesh-server/src/utils/Parser');

import * as P from '../src/services/evolution/EvolutionPathPolicy';
import { checkCandidate, checkOutput, sanitizeOutput } from '../src/services/evolution/EvolutionGuards';

afterAll(() => fs.rmSync(tmpRepo, { recursive: true, force: true }));

const w = (p: string, repo = 'AIMindMesh') => P.canWrite(repo, p);
const out = (extra: Record<string, unknown> = {}) =>
  ({ explanation: '', modifiedFileContent: '', estimatedImpact: 'low', breakingChange: false, skip: false, ...extra }) as any;

describe('path normalization', () => {
  const n = (p: unknown, repo = 'AIMindMesh') => P.normalizeRepoPath(repo, p);

  it('rejects traversal, absolute paths and URL-breaking characters', () => {
    for (const bad of ['../x', 'a/../../b', 'a/./b', '/etc/passwd', 'C:/x', 'a%2e.ts', 'a?b', 'a#b', 'a\\b', '', 42]) {
      expect(n(bad)).toBeNull();
    }
  });

  it('maps a leading src/ to the server only for this repository', () => {
    expect(n('src/x.ts')).toBe('aimindmesh-server/src/x.ts');
    expect(n('./src/x.ts')).toBe('aimindmesh-server/src/x.ts');
    expect(n('src/x.ts', 'my-app')).toBe('src/x.ts');
    expect(n('README.md')).toBe('README.md');
  });

  it('recognizes the self repo case-insensitively and validates repo names', () => {
    expect(P.isSelfRepo('aimindmesh')).toBe(true);
    expect(P.isSelfRepo('AIMindMesh.git')).toBe(true);
    expect(P.isSelfRepo('my-app')).toBe(false);
    expect(P.normalizeRepoName('../evil')).toBeNull();
    expect(P.normalizeRepoName('a/b')).toBeNull();
    expect(P.normalizeRepoName('my-app_2')).toBe('my-app_2');
  });
});

describe('secrets', () => {
  it('are never readable nor writable, with or without prefix', () => {
    for (const p of ['config.json', 'aimindmesh-server/config.json', 'openclaw-config/openclaw.json',
      'aimindmesh-server/openclaw-config/a.json', 'aimindmesh-server/firebase-service-account.json',
      'aimindmesh-server/.env', 'aimindmesh-server/data/operational.db', 'aimindmesh-server/src/config.ts']) {
      expect(w(p)).toBe(false);
      expect(P.canSendToLLM('AIMindMesh', p)).toBe(false);
    }
    expect(w('config.json', 'aimindmesh')).toBe(false);
    expect(P.canSendToLLM('AIMindMesh', 'aimindmesh-server/src/config.ts.example')).toBe(true);
  });
});

describe('protected paths', () => {
  it('cover guardrails, auth, build, CI and test infrastructure (baseline)', () => {
    for (const p of ['aimindmesh-server/src/index.ts', 'src/middleware/auth.ts', 'aimindmesh-server/src/services/evolution/EvolutionPathPolicy.ts',
      'aimindmesh-server/src/services/ValidationLayer.ts', 'aimindmesh-server/Dockerfile', 'aimindmesh-server/package.json',
      'aimindmesh-client/package.json', 'aimindmesh-mobile/tsconfig.json', 'aimindmesh-mobile/vite.config.ts', '.gitea/workflows/ci.yml',
      'deploy.sh', '.noautoedit', 'aimindmesh-server/test/auth.test.ts', 'aimindmesh-server/vitest.config.mts', 'aimindmesh-server/src/types/api.ts',
      'aimindmesh-mobile/android/app/src/main/java/com/aimindmesh/mobile/MainActivity.java', 'aimindmesh-client/src-tauri/src/lib.rs']) {
      expect(w(p)).toBe(false);
    }
  });

  it('include .noautoedit entries (files and directories) and DB prefixes', () => {
    expect(w('aimindmesh-server/src/services/KGManager.ts')).toBe(false);
    expect(w('aimindmesh-server/src/services/research/ResearchEngine.ts')).toBe(false);
    expect(w('aimindmesh-server/src/utils/Parser.ts')).toBe(false);
  });

  it('match DB prefixes literally ("_" is not a wildcard)', () => {
    expect(w('aimindmesh-server/src/services/Wiki_Synth.ts')).toBe(false);
    expect(w('aimindmesh-server/src/services/WikiXSynth.ts')).toBe(true);
  });

  it('leave regular files writable; other repos only get normalization', () => {
    expect(w('aimindmesh-server/src/services/WikiManager.ts')).toBe(true);
    expect(w('README.md')).toBe(true);
    expect(w('config.json', 'my-app')).toBe(true);
    expect(w('../x', 'my-app')).toBe(false);
  });
});

describe('resolveLocalServerPath', () => {
  it('only resolves self-repo, non-secret files inside the checkout', () => {
    expect(P.resolveLocalServerPath('my-app', 'README.md')).toBeNull();
    expect(P.resolveLocalServerPath('AIMindMesh', 'config.json')).toBeNull();
    expect(P.resolveLocalServerPath('AIMindMesh', 'aimindmesh-server/src/x.ts', SERVER_ROOT)).toBe(path.join(SERVER_ROOT, 'src/x.ts'));
  });
});

describe('guards', () => {
  it('block a candidate with a secret target', () => {
    expect(checkCandidate({ repository: 'AIMindMesh', targetComponent: 'aimindmesh-server/config.json' }).ok).toBe(false);
  });

  it('drop disallowed affected components instead of failing', () => {
    const res = checkCandidate({
      repository: 'AIMindMesh', target_component: 'aimindmesh-server/src/services/WikiManager.ts',
      affected_components: JSON.stringify(['src/config.ts', 'aimindmesh-server/src/services/FeedManager.ts', '../../etc/passwd']),
    });
    expect(res).toEqual({ ok: true, affected: ['aimindmesh-server/src/services/FeedManager.ts'] });
  });

  it('check every path an output would commit', () => {
    const target = 'aimindmesh-server/src/services/WikiManager.ts';
    expect(checkOutput('AIMindMesh', target, out({ additionalFiles: [{ path: '.noautoedit', content: 'x', reason: '' }] })).ok).toBe(false);
    expect(checkOutput('AIMindMesh', target, out({ unitTestContent: 'x', unitTestPath: '../../evil.ts' })).ok).toBe(false);
    expect(checkOutput('AIMindMesh', target, out({ additionalFiles: [{ path: 'src/services/FeedManager.ts', content: 'x', reason: '' }] })).ok).toBe(true);
  });

  it('drop a generated unit test that targets a protected path', () => {
    const output = out({ unitTestContent: 'test', unitTestPath: 'aimindmesh-server/test/x.test.ts' });
    expect(sanitizeOutput('AIMindMesh', output)).toBe('aimindmesh-server/test/x.test.ts');
    expect(output.unitTestPath).toBeUndefined();
    expect(checkOutput('AIMindMesh', 'aimindmesh-server/src/services/WikiManager.ts', output).ok).toBe(true);
  });
});
