import type { ValidationReport } from './ContainerValidationService';
import { criterionOfFile } from './VentureScaffold';

export interface MilestoneVerdict {
  ok: boolean;
  summary: string;
  /** Acceptance criteria whose test file passed. */
  passed: string[];
  /** Required criteria still failing. */
  missing: string[];
}

// Steps whose failure no test result can redeem
const BLOCKING_STEPS = new Set(['pull', 'start', 'extract', 'inspect', 'install', 'isolate', 'build']);

/**
 * A milestone is done when the build passes, every test written by the agent passes, and the
 * acceptance tests of this milestone and of the earlier ones pass. Acceptance tests of later
 * milestones may still fail: their code does not exist yet.
 */
export function evaluateMilestone(report: ValidationReport, required: string[]): MilestoneVerdict {
  const blocked = report.steps.find(s => !s.ok && BLOCKING_STEPS.has(s.name));
  if (blocked || !report.tests) {
    return { ok: false, summary: report.summary, passed: [], missing: required };
  }
  const files = report.tests.files ?? [];
  const passed = files.filter(f => f.status === 'passed' && f.passed > 0).map(f => criterionOfFile(f.file)).filter((c): c is string => !!c);
  const agentFiles = files.filter(f => !criterionOfFile(f.file));
  const brokenOwn = agentFiles.filter(f => f.status !== 'passed').map(f => f.file);
  const missing = required.filter(id => !passed.includes(id));

  if (brokenOwn.length > 0) {
    return { ok: false, summary: `Project tests failing: ${brokenOwn.slice(0, 5).join(', ')}`, passed, missing };
  }
  if (missing.length > 0) {
    return { ok: false, summary: `Acceptance criteria not met yet: ${missing.join(', ')}`, passed, missing };
  }
  return { ok: true, summary: `Build ok, acceptance ${passed.length} passing (${required.join(', ')} required)`, passed, missing };
}
