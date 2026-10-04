import db from '../../../db/sqlite';
import { config } from '../../../config';
import { Logger } from '../../../utils/Logger';
import { Parser } from '../../../utils/Parser';
import { InferenceRouter } from '../../InferenceRouter';
import type { ImprovementCandidate } from '../../ImprovementDetector';
import { canWrite, normalizeRepoPath } from '../EvolutionPathPolicy';
import { collectInferenceFailures, collectRuntimeErrors, RuntimeSignal, severityOf } from './RuntimeSignals';

const WEEK_MS = 7 * 86_400_000;

export function signalSettings() {
  const signals = config.autoEvolution?.signals;
  return {
    runtimeErrors: config.autoEvolution?.sources?.runtimeErrors !== false,
    inferenceFailures: config.autoEvolution?.sources?.inferenceFailures !== false,
    minOccurrences: signals?.minOccurrences ?? 5,
    minDays: signals?.minDays ?? 2,
    perCycle: signals?.maxCandidatesPerCycle ?? 3,
  };
}

/** Deterministic id: one candidate per error group, whatever title the model gives it. */
export const signalCandidateId = (signal: Pick<RuntimeSignal, 'kind' | 'fingerprint'>) => `${signal.kind}-${signal.fingerprint}`;

const PROMPT = (signal: RuntimeSignal, files: string[]) => `You maintain the AIMindMesh server (TypeScript, Node.js). This problem recurs in production:

Kind: ${signal.kind === 'runtime_error' ? `error logged by module "${signal.module}"` : `inference task of type "${signal.module}" failing`}
Occurrences: ${signal.count} over ${signal.days} day(s), last ${new Date(signal.lastSeen).toISOString()}
Pattern: ${signal.pattern}
Examples:
${signal.examples.map(e => `- ${e}`).join('\n')}

${signal.target ? `The file that emits it: ${signal.target}` : `Files that may be involved:\n${files.map(f => `- ${f}`).join('\n')}`}

If this is a defect of the code (not a misconfiguration, an external outage or expected input), describe the fix.
Respond ONLY with JSON:
{"title": "max 10 words", "description": "what is wrong and why, citing the evidence", "targetComponent": "one file from above",
 "affectedComponents": [], "changeScope": "single_file | multi_file", "proposedApproach": "how to fix it", "tags": []}
or {"skip": true, "reason": "..."} when the code should not change.`;

/**
 * Improvement candidates from runtime evidence. Each error group becomes at most one candidate
 * (deleting it allows a new one); severity comes from frequency and persistence, not from words.
 */
export async function detectSignalCandidates(fileList: () => string[], onCandidate?: (c: ImprovementCandidate) => void): Promise<ImprovementCandidate[]> {
  const settings = signalSettings();
  const options = { sinceMs: Date.now() - WEEK_MS, minOccurrences: settings.minOccurrences, minDays: settings.minDays, limit: 20 };
  const signals = [
    ...(settings.runtimeErrors ? collectRuntimeErrors(options) : []),
    ...(settings.inferenceFailures ? collectInferenceFailures(options) : []),
  ];
  const known = db.prepare('SELECT 1 FROM evolution_candidates WHERE id = ?');
  const fresh = signals.filter(s => !known.get(signalCandidateId(s))).slice(0, settings.perCycle);

  const out: ImprovementCandidate[] = [];
  for (const signal of fresh) {
    const files = signal.candidates.length ? signal.candidates : fileList();
    try {
      const parsed = Parser.parseLLMJson(await InferenceRouter.complete(PROMPT(signal, files), 'IMPROVEMENT_DETECTION', {
        taskName: `Improvement Detection (${signal.kind}): ${signal.module}`,
      }));
      if (parsed?.skip) {
        Logger.info('SignalCandidates', `Signal ${signal.fingerprint.slice(0, 8)} (${signal.module}) not a code defect: ${parsed.reason ?? ''}`);
        continue;
      }
      const target = signal.target ?? normalizeRepoPath('AIMindMesh', parsed?.targetComponent);
      if (!target || !canWrite('AIMindMesh', target) || (!signal.target && !files.includes(target))) continue;
      const candidate: ImprovementCandidate = {
        id: signalCandidateId(signal),
        source: signal.kind,
        sourceId: signal.fingerprint,
        title: String(parsed?.title ?? `Recurring error in ${signal.module}`).slice(0, 120),
        description: `${String(parsed?.description ?? '')}\n\nEvidence: ${signal.count} occurrences over ${signal.days} day(s). Pattern: ${signal.pattern}`,
        repository: 'AIMindMesh',
        targetComponent: target,
        affectedComponents: (Array.isArray(parsed?.affectedComponents) ? parsed.affectedComponents : []).filter((p: unknown): p is string => typeof p === 'string' && canWrite('AIMindMesh', p)),
        changeScope: parsed?.changeScope === 'multi_file' ? 'multi_file' : 'single_file',
        targetLanguage: 'typescript',
        severity: severityOf(signal),
        confidence: signal.target ? 0.9 : 0.7,
        proposedApproach: typeof parsed?.proposedApproach === 'string' ? parsed.proposedApproach : undefined,
        tags: ['evidence', signal.kind, signal.module],
        createdAt: Date.now(),
        status: 'pending',
      };
      out.push(candidate);
      onCandidate?.(candidate);
    } catch (err: any) {
      Logger.warn('SignalCandidates', `Signal ${signal.fingerprint.slice(0, 8)} (${signal.module}) not turned into a candidate: ${err.message}`);
    }
  }
  return out;
}
