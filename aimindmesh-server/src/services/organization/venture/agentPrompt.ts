import type { Directive } from '../../../types/api';
import { TEMPLATE_CONTRACT, type AcceptanceCriterion, type VentureSpec } from './VentureSpec';

/** The milestone a run works on (ventures with a structured spec). */
export interface MilestoneTask {
  seq: number;
  total: number;
  title: string;
  criteria: AcceptanceCriterion[];
  /** Criteria already passing. */
  passing: string[];
  spec: VentureSpec;
}

/** What the next agent run needs to know about the last server-side validation. */
export interface LastValidation {
  status: 'passed' | 'failed';
  summary: string;
  failures?: string[];
  /** Acceptance criteria still failing (milestone runs). */
  missing?: string[];
  /** Server-owned files the agent had changed (restored). */
  discarded?: string[];
  /** Output of the step that failed (tail). */
  output?: string;
  at: string;
}

export function parseLastValidation(raw: unknown): LastValidation | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value.summary === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Prompt of one development run. It holds no URL and no credential: the project folder is
 * already checked out at the last validated state, and the server snapshots, validates and
 * pushes it when the agent is done.
 */
export function buildAgentPrompt(input: {
  title: string;
  problemStatement: string;
  projectPath: string;
  directives: Directive[];
  lastValidation: LastValidation | null;
  attempt: number;
  milestone?: MilestoneTask | null;
}): string {
  const directives = input.directives.length
    ? input.directives.map(d => `- [${d.goalType.toUpperCase()}] ${d.title}: ${d.description}`).join('\n')
    : '- (none)';

  let previous = '';
  if (input.lastValidation?.status === 'failed') {
    const failures = input.lastValidation.failures?.length ? `\nFailing tests:\n${input.lastValidation.failures.map(f => `- ${f}`).join('\n')}` : '';
    const output = input.lastValidation.output ? `\nOutput of the failing step (end):\n${input.lastValidation.output.slice(-2000)}` : '';
    const discarded = input.lastValidation.discarded?.length
      ? `\nYour changes to these platform files were discarded: ${input.lastValidation.discarded.join(', ')}` : '';
    previous = `\n## The last validation FAILED: fix this first\n${input.lastValidation.summary}${failures}${output}${discarded}\n`;
  }

  const m = input.milestone;
  const task = m
    ? `## Task: milestone ${m.seq} of ${m.total} — ${m.title}
Make these acceptance criteria pass (their tests are acceptance/<id>.test.ts, already in the folder):
${m.criteria.map(c => `- ${c.id}${m.passing.includes(c.id) ? ' (already passing)' : ''}: Given ${c.given}, when ${c.when}, then ${c.then}.`).join('\n')}
Criteria of earlier milestones must keep passing; later ones may still fail.
Template: ${TEMPLATE_CONTRACT[m.spec.template]}
Public interface the tests use (implement exactly these names and shapes):
${m.spec.publicInterface}
The files in acceptance/ and vitest.config.ts belong to the platform: do not edit them (changes are discarded).
Add your own tests under test/. End with a short summary of what you changed and what is still missing.`
    : `## Task (run ${input.attempt})
Implement the next most valuable part of the specification that is not done yet, keeping everything that already
works. End with a short summary of what you changed and what is still missing.`;

  return `You are the developer of the product "${input.title}".
Problem it solves: ${input.problemStatement}

## Your project folder
\`${input.projectPath}\` inside your workspace. Work ONLY in that folder. It already contains the latest validated
version of the project; TECHNICAL_SPECIFICATION.md describes the product to build.
${previous}
## Rules
- Do not run git, do not create or edit any .git folder, do not push: when you finish, the platform takes a snapshot
  of the folder, validates it in an isolated container and publishes it only if the validation passes.
- The validation runs: npm ci (or npm install) without lifecycle scripts, npm run build (if defined), then vitest.
  Tests run WITHOUT network access.
- A Node.js project with package.json at the folder root. Tests use vitest (devDependency "vitest" from the npm
  registry, test files *.test.ts or *.test.js). Every feature you add has a meaningful test.
- No placeholders, stubs, mock data in place of real logic, or TODO comments.
- Before you finish, run in the folder: npm install, npm run build (if defined) and npx vitest run. Fix every failure.

## Directives
${directives}

${task}`;
}
