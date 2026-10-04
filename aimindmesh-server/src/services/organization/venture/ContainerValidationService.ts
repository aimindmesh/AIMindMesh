import type { Readable } from 'node:stream';
import { DockerCli, dockerCli, DockerResult } from './DockerCli';

export interface ValidationStep {
  name: string;
  ok: boolean;
  durationMs: number;
  output: string;
}

export interface TestSummary {
  runner: 'vitest' | 'jest';
  total: number;
  passed: number;
  failed: number;
  /** Names of the failed tests (at most 20). */
  failures: string[];
  /** Names of the passed tests (used to match acceptance criteria). */
  passedNames: string[];
  /** Per test file, path relative to the project root. A file that fails to load counts as failed. */
  files: { file: string; status: 'passed' | 'failed'; passed: number; failed: number }[];
}

export interface ValidationReport {
  status: 'passed' | 'failed';
  summary: string;
  steps: ValidationStep[];
  tests?: TestSummary;
}

export interface ValidationOptions {
  image: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export const VALIDATION_LABEL = 'aimindmesh.venture';

const WORK_DIR = '/tmp/w';
const REPORT_FILE = '/tmp/test-report.json';
const STEP_OUTPUT = 4000;
const PULL_TIMEOUT_MS = 10 * 60_000;

// Reads package.json inside the container: no project file is ever parsed by the server process
const INSPECT_SCRIPT = `
const fs = require('fs');
let p = null;
try { p = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch (e) {}
const d = p ? Object.assign({}, p.dependencies || {}, p.devDependencies || {}) : {};
const runner = d.vitest ? 'vitest' : (d.jest ? 'jest' : null);
console.log(JSON.stringify({
  hasPackage: !!p,
  hasLock: fs.existsSync('package-lock.json'),
  hasBuild: !!(p && p.scripts && p.scripts.build),
  runner,
  spec: runner ? String(d[runner]) : null,
}));
`;

/** A registry version range: no file:, link:, git, URL or path that could ship a fake test runner. */
export function isRegistrySpec(spec: string): boolean {
  return spec.length > 0 && spec.length < 64 && !/[:/\\]/.test(spec) && !spec.startsWith('.');
}

/** The only mapping from a validation result to the repository status. */
export function toRepoStatus(report: Pick<ValidationReport, 'status'>): 'healthy' | 'broken' {
  return report.status === 'passed' ? 'healthy' : 'broken';
}

const tail = (text: string) => (text.length > STEP_OUTPUT ? text.slice(text.length - STEP_OUTPUT) : text).trim();

/** Parses a vitest/jest JSON report (same shape). */
export function parseTestReport(raw: string, runner: TestSummary['runner']): TestSummary | null {
  try {
    const json = JSON.parse(raw);
    const results: any[] = (json.testResults ?? []).flatMap((file: any) => file.assertionResults ?? []);
    const name = (r: any) => String(r.fullName || r.title || '');
    const files = (json.testResults ?? []).map((file: any) => {
      const assertions: any[] = file.assertionResults ?? [];
      const passed = assertions.filter(a => a.status === 'passed').length;
      const failed = assertions.filter(a => a.status === 'failed').length;
      return {
        file: String(file.name ?? '').replace(/\\/g, '/').replace(new RegExp(`^${WORK_DIR}/`), ''),
        status: file.status === 'passed' && failed === 0 ? 'passed' as const : 'failed' as const,
        passed,
        failed,
      };
    });
    return {
      files,
      runner,
      total: Number(json.numTotalTests) || 0,
      passed: Number(json.numPassedTests) || 0,
      failed: Number(json.numFailedTests) || 0,
      failures: results.filter(r => r.status === 'failed').map(name).slice(0, 20),
      passedNames: results.filter(r => r.status === 'passed').map(name),
    };
  } catch {
    return null;
  }
}

/**
 * Builds and tests a venture snapshot in a throw-away container.
 *
 * The archive is streamed in (no volumes, no host paths), dependencies are installed without
 * lifecycle scripts while the container is on the default bridge network, then the network is
 * disconnected before any project code (build, tests) runs. The container is labelled, removed
 * at the end and swept at boot. Passing means: a supported runner from the registry, at least
 * one test and no failure.
 */
export class ContainerValidationService {
  constructor(private readonly docker: DockerCli = dockerCli) {}

  async validate(slug: string, archive: () => Readable, options: ValidationOptions): Promise<ValidationReport> {
    const name = `av-${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)}-${Date.now()}`;
    const deadline = Date.now() + options.timeoutMs;
    const steps: ValidationStep[] = [];
    const fail = (summary: string, tests?: TestSummary): ValidationReport => ({ status: 'failed', summary, steps, tests });

    const step = async (stepName: string, args: string[], extra: { input?: Readable; maxMs?: number } = {}): Promise<DockerResult & { ok: boolean }> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || options.signal?.aborted) {
        const result = { code: null, stdout: '', stderr: options.signal?.aborted ? 'cancelled' : 'validation timed out', timedOut: true, ok: false };
        steps.push({ name: stepName, ok: false, durationMs: 0, output: result.stderr });
        return result;
      }
      const started = Date.now();
      const result = await this.docker.run(args, {
        input: extra.input,
        timeoutMs: Math.min(remaining, extra.maxMs ?? remaining),
        signal: options.signal,
      });
      const ok = result.code === 0 && !result.timedOut;
      const output = tail([result.stdout, result.stderr].filter(Boolean).join('\n')) + (result.timedOut ? '\n[timed out]' : '');
      steps.push({ name: stepName, ok, durationMs: Date.now() - started, output });
      return { ...result, ok };
    };
    const exec = (...cmd: string[]) => ['exec', '-w', WORK_DIR, name, ...cmd];

    if (!(await this.ensureImage(options.image, steps))) return fail(`Validation image ${options.image} is not available`);

    const started = await step('start', [
      'run', '-d', '--rm', '--name', name,
      '--label', `${VALIDATION_LABEL}=1`, '--label', `${VALIDATION_LABEL}.repo=${slug}`,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '2g', '--cpus', '2', '--pids-limit', '512',
      '--user', '1000:1000', '-e', 'HOME=/tmp/home', '-e', 'npm_config_cache=/tmp/home/.npm', '-e', 'CI=true',
      options.image, 'sleep', String(Math.ceil(options.timeoutMs / 1000) + 120),
    ]);
    if (!started.ok) return fail('The validation container did not start');

    try {
      const extracted = await step('extract', ['exec', '-i', name, 'sh', '-c', `mkdir -p ${WORK_DIR} /tmp/home && tar -x -C ${WORK_DIR}`], { input: archive() });
      if (!extracted.ok) return fail('The snapshot could not be copied into the container');

      const inspected = await step('inspect', exec('node', '-e', INSPECT_SCRIPT));
      let info: { hasPackage: boolean; hasLock: boolean; hasBuild: boolean; runner: TestSummary['runner'] | null; spec: string | null };
      try {
        info = JSON.parse(inspected.stdout.trim().split('\n').pop() || '');
      } catch {
        return fail('package.json could not be inspected');
      }
      if (!info.hasPackage) return fail('No package.json at the repository root');
      if (!info.runner) return fail('No supported test runner: add vitest (or jest) to devDependencies and write tests');
      if (!info.spec || !isRegistrySpec(info.spec)) return fail(`The ${info.runner} dependency must be a registry version range, not "${info.spec}"`);

      const install = info.hasLock
        ? exec('npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund')
        : exec('npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund');
      if (!(await step('install', install)).ok) return fail('Dependency installation failed');

      // From here on project code runs: no network
      if (!(await step('isolate', ['network', 'disconnect', 'bridge', name])).ok) return fail('The container could not be isolated from the network');

      if (info.hasBuild && !(await step('build', exec('npm', 'run', 'build'))).ok) return fail('Build failed');

      const testArgs = info.runner === 'vitest'
        ? exec('node_modules/.bin/vitest', 'run', '--reporter=json', `--outputFile=${REPORT_FILE}`)
        : exec('node_modules/.bin/jest', '--ci', '--json', `--outputFile=${REPORT_FILE}`);
      const testRun = await step('test', testArgs);
      const report = await step('report', ['exec', name, 'cat', REPORT_FILE]);
      const tests = report.ok ? parseTestReport(report.stdout, info.runner) : null;

      if (!tests) return fail(testRun.timedOut ? 'Tests timed out' : 'Tests did not produce a report');
      if (tests.total === 0) return fail('No tests were found', tests);
      if (tests.failed > 0 || !testRun.ok) return fail(`${tests.failed || 'Some'} of ${tests.total} tests failed`, tests);
      return { status: 'passed', summary: `Build ok, ${tests.passed}/${tests.total} tests passed`, steps, tests };
    } finally {
      await this.docker.run(['rm', '-f', name], { timeoutMs: 60_000 }).catch(() => undefined);
    }
  }

  /** Removes validation containers left by a crash or a restart. Returns how many were removed. */
  async sweep(): Promise<number> {
    const list = await this.docker.run(['ps', '-aq', '--filter', `label=${VALIDATION_LABEL}=1`], { timeoutMs: 30_000 });
    const ids = list.code === 0 ? list.stdout.split('\n').map(s => s.trim()).filter(id => /^[a-f0-9]{6,64}$/.test(id)) : [];
    if (ids.length > 0) await this.docker.run(['rm', '-f', ...ids], { timeoutMs: 60_000 });
    return ids.length;
  }

  private async ensureImage(image: string, steps: ValidationStep[]): Promise<boolean> {
    const present = await this.docker.run(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 30_000 });
    if (present.code === 0) return true;
    const started = Date.now();
    const pulled = await this.docker.run(['pull', '--quiet', image], { timeoutMs: PULL_TIMEOUT_MS });
    steps.push({ name: 'pull', ok: pulled.code === 0, durationMs: Date.now() - started, output: tail(pulled.stderr || pulled.stdout) });
    return pulled.code === 0;
  }
}
