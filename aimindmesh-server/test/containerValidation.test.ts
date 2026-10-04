import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ContainerValidationService, isRegistrySpec, parseTestReport, toRepoStatus,
} from '../src/services/organization/venture/ContainerValidationService';
import type { DockerCli, DockerResult } from '../src/services/organization/venture/DockerCli';

type Script = (args: string[]) => Partial<DockerResult> | undefined;

/** Fake docker CLI: records every call, answers from a script (default: success). */
function fakeDocker(script: Script = () => undefined) {
  const calls: string[][] = [];
  const docker: DockerCli = {
    async run(args) {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...(script(args) ?? {}) };
    },
  };
  return { docker, calls };
}

const inspect = (info: object) => (args: string[]) =>
  args.includes('-e') && args[args.indexOf('-e') - 1] === 'node' ? { stdout: JSON.stringify(info) } : undefined;

const report = (failed: number) => JSON.stringify({
  numTotalTests: 3, numPassedTests: 3 - failed, numFailedTests: failed,
  testResults: [{ assertionResults: [
    { fullName: 'AC-1 lists items', status: 'passed' },
    { fullName: 'AC-2 adds an item', status: failed ? 'failed' : 'passed' },
    { fullName: 'smoke', status: 'passed' },
  ] }],
});

const archive = () => Readable.from(['tar']);
const options = { image: 'node:22-bookworm-slim', timeoutMs: 60_000 };
const vitestInfo = { hasPackage: true, hasLock: true, hasBuild: true, runner: 'vitest', spec: '^3.2.0' };

describe('container validation', () => {
  it('installs online, isolates the container, then builds and tests offline', async () => {
    const { docker, calls } = fakeDocker(args => inspect(vitestInfo)(args) ?? (args.includes('cat') ? { stdout: report(0) } : undefined));
    const result = await new ContainerValidationService(docker).validate('demo', archive, options);

    expect(result.status).toBe('passed');
    expect(result.tests).toMatchObject({ runner: 'vitest', total: 3, failed: 0 });
    expect(result.tests!.passedNames).toContain('AC-1 lists items');
    const names = result.steps.map(s => s.name);
    expect(names).toEqual(['start', 'extract', 'inspect', 'install', 'isolate', 'build', 'test', 'report']);

    const start = calls.find(c => c[0] === 'run')!;
    expect(start).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000', '--label', 'aimindmesh.venture=1']));
    expect(start).not.toContain('-v');
    expect(calls.find(c => c.includes('ci'))).toEqual(expect.arrayContaining(['npm', 'ci', '--ignore-scripts']));
    // network is cut before the first project command runs
    const isolateAt = calls.findIndex(c => c[0] === 'network');
    const buildAt = calls.findIndex(c => c.includes('build') && c.includes('run') && c.includes('npm'));
    expect(isolateAt).toBeGreaterThan(-1);
    expect(isolateAt).toBeLessThan(buildAt);
    // the container is always removed
    expect(calls[calls.length - 1]).toEqual(['rm', '-f', expect.stringMatching(/^av-demo-\d+$/)]);
  });

  it('fails when tests fail, are missing or do not run', async () => {
    const failing = fakeDocker(args => inspect(vitestInfo)(args) ?? (args.includes('cat') ? { stdout: report(1) } : args.includes('node_modules/.bin/vitest') ? { code: 1 } : undefined));
    const result = await new ContainerValidationService(failing.docker).validate('demo', archive, options);
    expect(result).toMatchObject({ status: 'failed', summary: '1 of 3 tests failed' });
    expect(result.tests!.failures).toEqual(['AC-2 adds an item']);

    const empty = fakeDocker(args => inspect(vitestInfo)(args) ?? (args.includes('cat') ? { stdout: JSON.stringify({ numTotalTests: 0 }) } : undefined));
    expect((await new ContainerValidationService(empty.docker).validate('demo', archive, options)).summary).toBe('No tests were found');

    const noRunner = fakeDocker(inspect({ ...vitestInfo, runner: null, spec: null }));
    const res = await new ContainerValidationService(noRunner.docker).validate('demo', archive, options);
    expect(res.summary).toMatch(/No supported test runner/);
    expect(noRunner.calls.some(c => c.includes('npm'))).toBe(false);
  });

  it('refuses a test runner that does not come from the registry', async () => {
    const { docker, calls } = fakeDocker(inspect({ ...vitestInfo, spec: 'file:./vendor/fake-vitest' }));
    const result = await new ContainerValidationService(docker).validate('demo', archive, options);
    expect(result.summary).toMatch(/registry version range/);
    expect(calls.some(c => c.includes('npm'))).toBe(false);
  });

  it('fails closed when the network cannot be disconnected', async () => {
    const { docker, calls } = fakeDocker(args => inspect(vitestInfo)(args) ?? (args[0] === 'network' ? { code: 1 } : undefined));
    const result = await new ContainerValidationService(docker).validate('demo', archive, options);
    expect(result.summary).toMatch(/isolated/);
    expect(calls.some(c => c.includes('build'))).toBe(false);
  });

  it('sweeps leftover containers by label', async () => {
    const { docker, calls } = fakeDocker(args => (args[0] === 'ps' ? { stdout: 'abc123\nnot-an-id!\n' } : undefined));
    expect(await new ContainerValidationService(docker).sweep()).toBe(1);
    expect(calls[1]).toEqual(['rm', '-f', 'abc123']);
  });

  it('helpers', () => {
    expect(isRegistrySpec('^3.2.0')).toBe(true);
    expect(isRegistrySpec('latest')).toBe(true);
    for (const bad of ['file:../x', 'github:a/b', 'git+https://x', './vendor', 'a/b']) expect(isRegistrySpec(bad)).toBe(false);
    expect(parseTestReport('not json', 'jest')).toBeNull();
    expect(toRepoStatus({ status: 'passed' })).toBe('healthy');
    expect(toRepoStatus({ status: 'failed' })).toBe('broken');
  });
});

// Real docker, opt-in (VENTURE_DOCKER_IT=1) and only with an image already present: nothing is downloaded
const IT_IMAGE = process.env.VENTURE_DOCKER_IT_IMAGE || 'node:24-alpine';
const dockerReady = (() => {
  if (process.env.VENTURE_DOCKER_IT !== '1') return false;
  try {
    execFileSync('docker', ['image', 'inspect', IT_IMAGE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!dockerReady)('container validation on a real docker daemon', () => {
  it('copies the snapshot in, inspects it as a non-root user and removes the container', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venture-it-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { vitest: 'file:../evil' } }));
    const tarStream = () => Readable.from([execFileSync('tar', ['-c', '-C', dir, '.'])]);

    const result = await new ContainerValidationService().validate('it-demo', tarStream, { image: IT_IMAGE, timeoutMs: 120_000 });

    expect(result.summary).toMatch(/registry version range/);
    expect(result.steps.map(s => s.name)).toEqual(['start', 'extract', 'inspect']);
    const left = execFileSync('docker', ['ps', '-aq', '--filter', 'label=aimindmesh.venture.repo=it-demo'], { encoding: 'utf-8' });
    expect(left.trim()).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  }, 150_000);
});
