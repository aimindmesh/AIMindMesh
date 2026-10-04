import db from '../../../db/sqlite';
import { Logger } from '../../../utils/Logger';
import { SQLiteDirectiveRepository } from '../DirectiveService';
import { VentureWorkspace, giteaAuthHeader, giteaCloneUrl } from './VentureWorkspace';
import { ContainerValidationService, ValidationReport } from './ContainerValidationService';
import { buildAgentPrompt, LastValidation, MilestoneTask, parseLastValidation } from './agentPrompt';
import type { BuildSettings } from './BuildSettings';
import { currentMilestone, criteriaOf, loadDesign, milestoneRows, recordMilestoneAttempt, requiredCriteria, StoredDesign } from './Milestones';
import { ACCEPTANCE_DIR, canonicalFiles, scaffoldFiles } from './VentureScaffold';
import { evaluateMilestone } from './milestoneVerdict';

export type RunOutcome =
  /** next: another milestone to build, the MVP is complete, or no milestones (legacy repository) */
  | { kind: 'healthy'; summary: string; commit: string; next: 'milestone' | 'mvp_ready' | 'none' }
  | { kind: 'failed'; summary: string }
  | { kind: 'cancelled' };

export interface AgentRunResult {
  status: 'ok' | 'error' | 'timeout' | 'cancelled' | 'disconnected';
  reply: string;
  error?: string;
}

/** The development agent, behind a seam (OpenClaw in production, a fake in tests). */
export interface AgentRunner {
  run(prompt: string, sessionKey: string, options: { timeoutMs: number; signal: AbortSignal; model: string | null }): Promise<AgentRunResult>;
}

export interface RepoRow {
  id: string;
  repo_name: string;
  gitea_url: string;
  created_from_idea_id: string | null;
  retry_count: number;
  last_validation: string | null;
}

export const sessionKeyOf = (repoName: string) => `develop-${repoName}`;

const STEP_OUTPUT = 2000;

function toLastValidation(report: ValidationReport, verdict?: { ok: boolean; summary: string; missing: string[] }, discarded: string[] = []): LastValidation {
  const failedStep = [...report.steps].reverse().find(s => !s.ok);
  const ok = verdict ? verdict.ok : report.status === 'passed';
  return {
    status: ok ? 'passed' : 'failed',
    summary: verdict?.summary ?? report.summary,
    failures: report.tests?.failures,
    missing: verdict?.missing,
    discarded: discarded.length ? discarded : undefined,
    output: !ok && failedStep ? `[${failedStep.name}] ${failedStep.output.slice(-STEP_OUTPUT)}` : undefined,
    at: new Date().toISOString(),
  };
}

/** The milestone this run works on, with its criteria and what already passes. */
function milestoneTask(ideaId: string, design: StoredDesign): { task: MilestoneTask; row: ReturnType<typeof currentMilestone> } | null {
  const row = currentMilestone(ideaId);
  if (!row) return null;
  const ids = criteriaOf(row);
  return {
    row,
    task: {
      seq: row.seq,
      total: milestoneRows(ideaId).length,
      title: row.title,
      criteria: design.spec.acceptanceCriteria.filter(c => ids.includes(c.id)),
      passing: JSON.parse(row.passed_json || '[]'),
      spec: design.spec,
    },
  };
}

function saveLastValidation(repoId: string, value: LastValidation): void {
  db.prepare('UPDATE organization_repositories SET last_validation = ? WHERE id = ?').run(JSON.stringify(value), repoId);
}

/**
 * One attempt on a venture repository: reset the work tree to the last validated commit, let the
 * agent work, snapshot what it wrote, validate it in a container and push it only if it passes.
 */
export async function executeBuildRun(
  repo: RepoRow,
  settings: BuildSettings,
  deps: { agent: AgentRunner; validator?: ContainerValidationService; workspace?: VentureWorkspace; signal: AbortSignal },
): Promise<RunOutcome> {
  const workspace = deps.workspace ?? new VentureWorkspace(repo.repo_name);
  const validator = deps.validator ?? new ContainerValidationService();
  const remote = giteaCloneUrl(repo.gitea_url);
  const auth = giteaAuthHeader(remote);

  const base = await workspace.prepare(remote, auth);

  // Ventures with a structured spec: scaffold on the first run, server-owned tests always in place
  const design = repo.created_from_idea_id ? loadDesign(repo.created_from_idea_id) : null;
  const current = design && repo.created_from_idea_id ? milestoneTask(repo.created_from_idea_id, design) : null;
  const canonical = design ? canonicalFiles(design.spec.template, design.acceptance) : null;
  if (design && canonical) {
    if (!(await workspace.exists('package.json'))) {
      const titleRow = db.prepare('SELECT title FROM organization_ideas WHERE id = ?').get(repo.created_from_idea_id) as { title: string } | undefined;
      await workspace.writeFiles(scaffoldFiles(design.spec.template, repo.repo_name, titleRow?.title ?? repo.repo_name));
    }
    await workspace.writeFiles(canonical, [ACCEPTANCE_DIR]);
    await workspace.handOverToAgent();
  }

  const idea = repo.created_from_idea_id
    ? db.prepare('SELECT title, problem_statement FROM organization_ideas WHERE id = ?').get(repo.created_from_idea_id) as { title: string; problem_statement: string } | undefined
    : undefined;
  const directives = repo.created_from_idea_id
    ? await new SQLiteDirectiveRepository().findActiveForIdea(repo.created_from_idea_id)
    : await new SQLiteDirectiveRepository().findActiveGlobal();

  const prompt = buildAgentPrompt({
    title: idea?.title ?? repo.repo_name,
    problemStatement: idea?.problem_statement ?? '',
    projectPath: workspace.agentPath,
    directives,
    lastValidation: parseLastValidation(repo.last_validation),
    attempt: (repo.retry_count ?? 0) + 1,
    milestone: current?.task ?? null,
  });

  const agent = await deps.agent.run(prompt, sessionKeyOf(repo.repo_name), {
    timeoutMs: settings.agentRunTimeoutMs,
    signal: deps.signal,
    model: settings.model,
  });
  if (agent.status === 'cancelled' || deps.signal.aborted) return { kind: 'cancelled' };
  if (agent.status !== 'ok') {
    // A timed-out or failed run may still have written useful files: validate them anyway
    Logger.warn('VentureBuild', `Agent run on ${repo.repo_name} ended with ${agent.status}: ${agent.error ?? ''}`);
  }

  // Whatever the agent did to the platform's files is undone before the snapshot
  const discarded = canonical ? await workspace.writeFiles(canonical, [ACCEPTANCE_DIR]) : [];
  const label = current ? `milestone ${current.task.seq}` : `run ${(repo.retry_count ?? 0) + 1}`;
  const commit = await workspace.snapshot(`venture ${label} (${agent.status})`);
  if (!commit) {
    const summary = agent.status === 'ok' ? 'The agent finished without changing any file' : `The agent run ended with ${agent.status} without changing any file`;
    saveLastValidation(repo.id, { status: 'failed', summary, at: new Date().toISOString() });
    return { kind: 'failed', summary };
  }

  const report = await validator.validate(repo.repo_name, () => workspace.archive(commit), {
    image: settings.validationImage,
    timeoutMs: settings.validationTimeoutMs,
    signal: deps.signal,
  });
  if (deps.signal.aborted) return { kind: 'cancelled' };

  let summary = report.summary;
  let next: 'milestone' | 'mvp_ready' | 'none' = 'none';
  if (current?.row && repo.created_from_idea_id) {
    const verdict = evaluateMilestone(report, requiredCriteria(repo.created_from_idea_id, current.row));
    saveLastValidation(repo.id, toLastValidation(report, verdict, discarded));
    recordMilestoneAttempt(current.row, verdict.passed, verdict.ok);
    if (!verdict.ok) return { kind: 'failed', summary: verdict.summary };
    summary = `Milestone ${current.task.seq}/${current.task.total} done. ${verdict.summary}`;
    next = currentMilestone(repo.created_from_idea_id) ? 'milestone' : 'mvp_ready';
  } else {
    saveLastValidation(repo.id, toLastValidation(report, undefined, discarded));
    if (report.status !== 'passed') return { kind: 'failed', summary: report.summary };
  }

  await workspace.push(remote, commit, auth);
  const changes = await workspace.log(base, commit).catch(() => []);
  Logger.info('VentureBuild', `Pushed ${repo.repo_name} ${commit.slice(0, 8)} (${changes.length} commit(s)): ${summary}`);
  return { kind: 'healthy', summary, commit, next };
}
