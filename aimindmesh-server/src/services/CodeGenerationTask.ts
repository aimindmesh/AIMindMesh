import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger';
import { InferenceRouter } from './InferenceRouter';
import { config } from '../config';
import { ImprovementCandidate } from './ImprovementDetector';
import { Parser } from '../utils/Parser';
import { GiteaEvolutionService } from './GiteaEvolutionService';
import { MultiFileContextBuilder, MultiFileContext } from './MultiFileContextBuilder';

export interface CodeGenerationPayload {
  candidateId: string;
  targetComponent: string;
  targetLanguage: "typescript" | "kotlin" | "rust";
  currentFileContent: string;
  relatedFiles: RelatedFile[];
  proposedApproach: string;
  description: string;
  changeScope: string;               // ★ NEW
  affectedComponents: string[];      // ★ NEW
  feedbacks?: import('./FeedbackService').FeedbackRecord[]; // ★ NEW
  iterationCount?: number;            // ★ NEW
}

export interface RelatedFile {
  path: string;
  content: string;
  relationship: "target" | "imports" | "imported_by" | "shared_contract" | "db_schema" | "config_types" | "sibling_service";
  tier?: 1 | 2 | 3 | 4 | 5 | 6;        // ★ NEW
  truncated?: boolean;               // ★ NEW
}

export interface CodeGenerationOutput {
  explanation: string;
  modifiedFileContent: string;          // Primary file
  additionalFiles?: ModifiedFile[];     // ★ NEW: other files modified
  unitTestContent?: string;
  unitTestPath?: string;
  estimatedImpact: "low" | "medium" | "high";
  breakingChange: boolean;
  affectedEndpoints?: string[];
  skip: boolean;
  skipReason?: string;
}

export interface ModifiedFile {
  path: string;
  content: string;
  reason: string;  // Why this file was modified
}


const TIER_LABELS: Record<number, string> = {
  2: '## DIRECT DEPENDENCY — imported by target (read-only, do not modify)',
  3: '## ⚠️ REVERSE DEPENDENCY — this file CALLS your target (you must not break it)',
  4: '## SHARED CONTRACT — exported types/interfaces (you must remain compatible)',
  5: '## DATABASE SCHEMA — fixed DDL (column names and types cannot change)',
  6: '## CONFIG TYPES — configuration interface (use only existing keys)',
};

const CODE_GENERATION_PROMPT = (payload: CodeGenerationPayload): string => {
  const relatedFilesSection = payload.relatedFiles.length > 0
    ? payload.relatedFiles.map(f => {
      const tierKey = f.tier ?? 2;
      const label = TIER_LABELS[tierKey] ?? '## RELATED FILE (context only)';
      const truncNote = f.truncated ? '\n// NOTE: File shown partially to stay within token budget.' : '';
      return `${label}
### ${f.path}
\`\`\`typescript${truncNote}
${f.content}
\`\`\``;
    }).join('\n\n')
    : '';

  const affectedNote = payload.affectedComponents.length > 0
    ? `\n## FILES TO MODIFY TOGETHER\nBesides the target, these files likely need changes too:\n${payload.affectedComponents.map(f => `- \`${f}\``).join('\n')}`
    : '';

  return `You are an expert TypeScript/Node.js engineer working on the AIMindMesh ecosystem.
Your task is to implement a specific improvement that may span multiple files.

## IMPROVEMENT TO IMPLEMENT
${payload.description}

## PROPOSED APPROACH
${payload.proposedApproach}

## CHANGE SCOPE: ${payload.changeScope.toUpperCase()}
${affectedNote}

## TARGET FILE (PRIMARY — provide the full modified version): ${payload.targetComponent}
\`\`\`typescript
${payload.currentFileContent}
\`\`\`

${relatedFilesSection}

## STRICT RULES
1. Return ONLY valid JSON matching the schema below. No markdown outside the JSON.
2. "modifiedFileContent" must be the COMPLETE new content of ${payload.targetComponent} — not a diff.
3. Preserve ALL existing functionality. This is an additive/refinement improvement only.
4. Follow the existing code style, naming conventions, and error handling patterns.
5. If you cannot implement the improvement safely, set "skip": true with a reason.
6. Never add external npm dependencies not already present in the codebase.
7. REVERSE DEPENDENCY files (⚠️) show callers of your target. You MUST preserve all existing public method signatures. If a signature must change, set "breakingChange": true AND provide the updated version of the caller file in "additionalFiles".
8. SHARED CONTRACT files define types used across services. You MUST NOT change any exported interface, type alias, or enum unless "changeScope" is "interface_change". If you must change a type, add the updated type file to "additionalFiles".
9. DATABASE SCHEMA is fixed. Use only existing column names and types. If a migration is needed, mention it in your explanation.
10. Populate "affectedEndpoints" with any public method or REST route whose signature changes — even minimally.
11. For each file in "additionalFiles", provide its COMPLETE new content (not a diff) and a "reason" explaining why that file needed updating.

## OUTPUT SCHEMA
{
  "explanation": "plain English explanation of what changed and why (for developer review)",
  "modifiedFileContent": "complete new content of ${payload.targetComponent}",
  "additionalFiles": [
    {
      "path": "path/to/other/file.ts",
      "content": "complete new content",
      "reason": "why this file needed to be modified to maintain compatibility"
    }
  ],
  "unitTestContent": "complete content of the new or updated test file (optional)",
  "unitTestPath": "path to the test file (optional)",
  "estimatedImpact": "low | medium | high",
  "breakingChange": false,
  "affectedEndpoints": [],
  "skip": false,
  "skipReason": null
}
`.trim();
};

const FEEDBACK_GENERATION_PROMPT = (
  payload: CodeGenerationPayload,
  feedbackSection: string
): string => {
  const relatedFilesSection = payload.relatedFiles.length > 0
    ? payload.relatedFiles.map(f => {
      const label = TIER_LABELS[f.tier ?? 2] ?? '## RELATED FILE';
      const note = f.truncated ? '\n// NOTE: Shown partially.' : '';
      return `${label}\n### ${f.path}\n\`\`\`typescript${note}\n${f.content}\n\`\`\``;
    }).join('\n\n')
    : '';

  return `You are an expert TypeScript/Node.js engineer working on the AIMindMesh ecosystem.
This is ITERATION ${payload.iterationCount} of an iterative improvement process.
A developer has already reviewed iteration ${(payload.iterationCount ?? 1) - 1} and left feedback.

## ORIGINAL IMPROVEMENT GOAL
${payload.description}

## PROPOSED APPROACH
${payload.proposedApproach}

${feedbackSection}

## CURRENT FILE STATE (on the feature branch — this is what was generated in the previous iteration)
### ${payload.targetComponent}
\`\`\`typescript
${payload.currentFileContent}
\`\`\`

${relatedFilesSection}

## STRICT RULES (same as before, plus feedback-specific rules)
1. Return ONLY valid JSON. No markdown outside the JSON.
2. "modifiedFileContent" must be the COMPLETE new file — not a diff.
3. Preserve ALL existing functionality.
4. Follow existing code style and error handling patterns.
5. Never add external npm dependencies.
6. REVERSE DEPENDENCY files show callers — preserve all public signatures.
7. SHARED CONTRACT files define types — remain compatible.
8. DATABASE SCHEMA is fixed — use only existing columns.
9. ★ You MUST address ALL feedback points listed above. For each one, explain how you
   addressed it in the "explanation" field using the format: "Feedback #N: [what you did]".
10. ★ If a feedback asks you to REVERT something you changed, restore the original logic.
    Do not resist developer feedback — the developer has authority over code decisions.
11. ★ If a feedback is contradictory or impossible to implement, explain why in "explanation"
    and propose the closest safe alternative.
12. ★ Do NOT re-introduce issues that were fixed in previous iterations.

## OUTPUT SCHEMA
{
  "explanation": "For each feedback point: 'Feedback #N: [what you changed]'. Then a general summary.",
  "modifiedFileContent": "complete new content of ${payload.targetComponent}",
  "additionalFiles": [{ "path": "...", "content": "...", "reason": "..." }],
  "unitTestContent": "...",
  "unitTestPath": "...",
  "estimatedImpact": "low | medium | high",
  "breakingChange": false,
  "affectedEndpoints": [],
  "skip": false,
  "skipReason": null
}`.trim();
};


export class CodeGenerationTask {
  private readonly contextBuilder: MultiFileContextBuilder;

  constructor(private readonly giteaService?: GiteaEvolutionService) {
    this.contextBuilder = new MultiFileContextBuilder(giteaService);
  }

  async generate(candidate: ImprovementCandidate, options?: { routing?: string, model?: string }): Promise<CodeGenerationOutput> {
    Logger.info('CodeGenerationTask', `Starting generation for ${candidate.title}`, { target: candidate.targetComponent });

    const targetComp = candidate.targetComponent || (candidate as any).target_component;
    const repository = candidate.repository || (candidate as any).repo_name || 'AIMindMesh';
    const impact = candidate.severity > 7 ? 'high' : (candidate.severity > 4 ? 'medium' : 'low');

    const context = await this.contextBuilder.build(
      targetComp,
      repository,
      impact as any,
      candidate.affectedComponents || []
    );

    // Explicitly handle fallback for EVOLUTION tasks when routing is AUTO
    const providersToTry = (options?.routing && options.routing !== 'AUTO')
      ? [options.routing]
      : ['GEMINI', 'OPENROUTER'];

    let lastError: Error | null = null;

    for (const provider of providersToTry) {
      try {
        Logger.info('CodeGenerationTask', `Attempting generation with provider: ${provider}`);
        const res = await InferenceRouter.routeTask({
          type: 'EVOLUTION',
          prompt: CODE_GENERATION_PROMPT({
            candidateId: candidate.id,
            targetComponent: context.target.path,
            targetLanguage: candidate.targetLanguage,
            currentFileContent: context.target.content,
            relatedFiles: context.relatedFiles,
            proposedApproach: candidate.proposedApproach || '',
            description: candidate.description,
            changeScope: candidate.changeScope || 'single_file',
            affectedComponents: candidate.affectedComponents || []
          }),
          options: {
            taskName: `Evolution: ${candidate.title}`,
            routing: provider,
            model: options?.model,
            thinking: true
          },
          metadata: (options as any)?.metadata
        });

        return this.parseOutput(res.response);
      } catch (err: any) {
        lastError = err;
        Logger.warn('CodeGenerationTask', `Provider ${provider} failed: ${err.message}`);
        if (options?.routing && options.routing !== 'AUTO') break;
      }
    }

    throw new Error(`Code generation failed. All cloud providers exhausted. Last error: ${lastError?.message}`);
  }

  /**
   * Genera codice tenendo conto dei feedback precedenti del developer.
   */
  async generateWithFeedback(
    candidate: ImprovementCandidate,
    feedbacks: import('./FeedbackService').FeedbackRecord[],
    iterationCount: number,
    currentBranchContent: string,
    options?: { routing?: string; model?: string }
  ): Promise<CodeGenerationOutput> {
    Logger.info('CodeGenerationTask',
      `Feedback iteration ${iterationCount} for ${candidate.title} (${feedbacks.length} feedbacks)`
    );

    const targetComp = (candidate as any).targetComponent || (candidate as any).target_component;
    const repository = (candidate as any).repository || 'AIMindMesh';
    const impact = candidate.severity >= 7 ? 'high' : candidate.severity >= 4 ? 'medium' : 'low';

    const ctx = await this.contextBuilder.build(targetComp, repository, impact as any, candidate.affectedComponents || []);
    ctx.target = { ...ctx.target, content: currentBranchContent };

    const { feedbackService } = await import('./FeedbackService');
    const feedbackSection = feedbackService.formatFeedbackForPrompt(feedbacks);

    const payload: CodeGenerationPayload = {
      candidateId: candidate.id,
      targetComponent: targetComp,
      targetLanguage: candidate.targetLanguage ?? 'typescript',
      currentFileContent: currentBranchContent,
      relatedFiles: ctx.relatedFiles,
      proposedApproach: candidate.proposedApproach ?? '',
      description: candidate.description,
      changeScope: candidate.changeScope ?? 'single_file',
      affectedComponents: candidate.affectedComponents ?? [],
      feedbacks,
      iterationCount,
    };

    const prompt = FEEDBACK_GENERATION_PROMPT(payload, feedbackSection);

    const providersToTry = (options?.routing && options.routing !== 'AUTO')
      ? [options.routing]
      : ['GEMINI', 'OPENROUTER'];

    let lastError: Error | null = null;
    for (const provider of providersToTry) {
      try {
        Logger.info('CodeGenerationTask', `Feedback iteration ${iterationCount}: trying provider ${provider}`);
        const res = await InferenceRouter.routeTask({
          type: 'EVOLUTION',
          prompt,
          options: {
            taskName: `Evolution Feedback Iter ${iterationCount}: ${candidate.title}`,
            routing: provider,
            model: options?.model,
            thinking: true,
          },
          metadata: (options as any)?.metadata,
        });
        return this.parseOutput(res.response);
      } catch (err: any) {
        lastError = err;
        Logger.warn('CodeGenerationTask', `Provider ${provider} failed (feedback iter): ${err.message}`);
        if (options?.routing && options.routing !== 'AUTO') break;
      }
    }
    throw new Error(`Feedback generation failed. Last error: ${lastError?.message}`);
  }

  public async parseOutput(response: string): Promise<CodeGenerationOutput> {
    const parsed = Parser.parseLLMJson(response);
    return parsed as CodeGenerationOutput;
  }
}

