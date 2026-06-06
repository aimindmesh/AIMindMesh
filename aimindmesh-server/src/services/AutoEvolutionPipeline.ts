import * as cron from 'node-cron';
import { Logger } from '../utils/Logger';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import db from '../db/sqlite';
import { getSession } from '../db/neo4j';
import { ImprovementDetector, ImprovementCandidate } from './ImprovementDetector';
import { CodeGenerationTask, CodeGenerationOutput } from './CodeGenerationTask';
import { ValidationLayer } from './ValidationLayer';
import { GiteaEvolutionService } from './GiteaEvolutionService';
import { FeedManager } from './FeedManager';
import * as FCMDispatcher from './FCMDispatcher';
import { InferenceRouter } from './InferenceRouter';
import { IntentClassifier } from './IntentClassifier';
import { GiteaService } from './GiteaService';
import { v4 as uuidv4 } from 'uuid';

export class AutoEvolutionPipeline {
  private detector = new ImprovementDetector();
  private gitea = new GiteaEvolutionService();
  private generator = new CodeGenerationTask(this.gitea);
  private validator = new ValidationLayer();

  private job: cron.ScheduledTask | null = null;
  private isRunning = false;

  public async init() {
    // ✅ CRITICAL FIX [2026-04-30]: Clear existing job before re-scheduling
    if (this.job) {
      this.job.stop();
      this.job = null;
    }

    if (config.autoEvolution?.enabled) {
      const schedule = config.autoEvolution.cronExpression || '0 3 * * *';
      this.job = cron.schedule(schedule, () => this.runCycle());
      Logger.info('AutoEvolutionPipeline', `Initialized with schedule: ${schedule}`);
    } else {
      Logger.info('AutoEvolutionPipeline', 'Disabled by configuration');
    }

    // Register listener for evolution tasks (resiliency)
    this.registerInferenceListener();

    // Startup recovery: check for candidates stuck in 'generating'
    this.recoverStuckCandidates();
  }

  private registerInferenceListener() {
    InferenceRouter.onTaskCompleted(async (id: string, result: string, metadata: any, type: any) => {
      if (type === 'EVOLUTION' && metadata?.candidateId) {
        Logger.info('AutoEvolutionPipeline', `[HOOK] Intercepted evolution result for candidate ${metadata.candidateId}`);
        const candidate = db.prepare(`SELECT * FROM evolution_candidates WHERE id = ?`).get(metadata.candidateId) as any;
        if (candidate && (candidate.status === 'generating' || candidate.status === 'pending')) {
          await this.resumeEvolutionFromOutput(candidate, result);
        }
      }
    });
  }

  private recoverStuckCandidates() {
    const stuck = db.prepare(`SELECT * FROM evolution_candidates WHERE status = 'generating'`).all() as any[];
    for (const cand of stuck) {
      // If there's an active task for this in the registry, let the listener handle it.
      // Otherwise, reset to pending.
      const hasActiveTask = db.prepare(`SELECT 1 FROM inference_queue WHERE payload LIKE ? AND status IN ('QUEUED', 'PROCESSING')`)
        .get(`%"candidateId":"${cand.id}"%`);
      
      if (!hasActiveTask) {
        Logger.warn('AutoEvolutionPipeline', `[RECOVERY] Resetting orphaned candidate [${cand.id}] to pending`);
        this.updateCandidateStatus(cand.id, 'pending');
      }
    }
  }

  public async runCycle(manual: boolean = false): Promise<void> {
    if (this.isRunning) {
      Logger.warn('AutoEvolutionPipeline', 'Cycle already in progress, skipping');
      return;
    }

    this.isRunning = true;
    Logger.info('AutoEvolutionPipeline', 'Starting evolution cycle...');

    try {
      // 1. Check daily rate limit
      const startOfDay = new Date().setHours(0, 0, 0, 0);
      const todayCount = db.prepare(
        `SELECT COUNT(*) as c FROM evolution_proposals WHERE created_at > ? AND status != 'failed'`
      ).get(startOfDay) as { c: number };

      if (!manual && todayCount.c >= (config.autoEvolution?.maxProposalsPerDay ?? 3)) {
        Logger.info('AutoEvolutionPipeline', 'Daily limit reached, skipping cycle');
        return;
      }

      // 2. Detect candidates with real-time persistence
      await this.detector.detectCandidates((c) => {
        this.persistCandidate(c);
        Logger.info('AutoEvolutionPipeline', `Real-time candidate persisted: ${c.title}`);
      });

      // 3. ★ NEW [v3.0]: Process Feedback Loop
      Logger.info('AutoEvolutionPipeline', 'Checking for Gitea PR feedback...');
      const activeProposals = db.prepare(`SELECT * FROM evolution_proposals WHERE status = 'proposed'`).all() as any[];
      for (const proposal of activeProposals) {
        const newComments = await this.gitea.syncPrCommentsToFeedback(proposal.id);
        if (newComments > 0) {
          Logger.info('AutoEvolutionPipeline', `Synced ${newComments} new feedback comments for proposal ${proposal.id}`);
        }
      }

      // 4. Take the highest-severity candidate that is currently 'pending'
      const allPending = db.prepare(`SELECT * FROM evolution_candidates WHERE status = 'pending'`).all() as any[];
      if (allPending.length === 0) {
        Logger.info('AutoEvolutionPipeline', 'No pending candidates to process');
        return;
      }

      const candidate = allPending.sort((a, b) => b.severity - a.severity)[0];
      await this.executeEvolutionForCandidate(candidate);

    } catch (err: any) {
      Logger.error('AutoEvolutionPipeline', `Cycle failed: ${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  public async processSpecificCandidate(id: string, options?: { routing?: string; model?: string }): Promise<void> {
    const candidate = db.prepare(`SELECT * FROM evolution_candidates WHERE id = ?`).get(id) as any;
    if (!candidate) throw new Error('Candidate not found');
    
    // We allow multiple candidates to be enqueued; the InferenceRouter will handle serial execution.
    // Top-level catch: guarantee candidate is NEVER left stuck in 'generating' on any error.
    try {
      await this.executeEvolutionForCandidate(candidate, options);
    } catch (err: any) {
      Logger.error('AutoEvolutionPipeline', `Unhandled error for candidate [${id}]: ${err.message}`);
      await this.recordFailure(candidate, 'unhandled_error', err.message);
    }
  }

  private async executeEvolutionForCandidate(candidate: any, options?: { routing?: string; model?: string }) {
    Logger.info('AutoEvolutionPipeline', `Processing candidate: ${candidate.title} (Severity: ${candidate.severity})`);

    const repository = candidate.repository || candidate.repo_name || 'AIMindMesh';

    // 5. Update status
    this.updateCandidateStatus(candidate.id, 'generating');

    // 6. Check file existence before generation (Safety Check)
    const targetComp = candidate.targetComponent || candidate.target_component;
    const repoPath = config.autoEvolution?.repoLocalPath ?? '/app';
    const localPath = targetComp.startsWith('aimindmesh-server/')
      ? targetComp.substring('aimindmesh-server/'.length)
      : targetComp;
    const absPath = path.resolve(repoPath, localPath);
    
    if (!fs.existsSync(absPath)) {
      Logger.info('AutoEvolutionPipeline', `File ${targetComp} not found locally (localPath: ${localPath}), will attempt Gitea fetch during generation.`);
    }

    // 7. Generate code
    try {
      // ★ NEW [v2.0]: Save original content for cross-signature check
      let originalContent: string | undefined;
      try {
        if (fs.existsSync(absPath)) {
          originalContent = fs.readFileSync(absPath, 'utf-8');
          db.prepare(`UPDATE evolution_candidates SET original_content = ? WHERE id = ?`)
            .run(originalContent, candidate.id);
        }
      } catch (e) {}

      // Pass candidateId in metadata for the persistence listener
      const optionsWithMeta = { 
        ...options, 
        metadata: { ...((options as any)?.metadata || {}), candidateId: candidate.id } 
      };
      await this.generator.generate(candidate, optionsWithMeta);
      // Logic continues in resumeEvolutionFromOutput via InferenceRouter listener
    } catch (err: any) {
      if (err.message?.includes('TASK_STALLED')) {
        Logger.warn('AutoEvolutionPipeline', `Task STALLED for candidate [${candidate.id}]. Waiting for manual intervention.`);
        // We keep it in 'generating' state because the hook will resume it later if retried.
        return;
      }
      await this.recordFailure(candidate, 'generation_error', String(err));
      return;
    }
  }

  /**
   * Resumes the evolution process (Validation -> Proposal) using the LLM output.
   * Can be called by the generation loop or the persistent listener.
   */
  public async resumeEvolutionFromOutput(candidate: any, llmOutput: string) {
    if (candidate.status === 'validating' || candidate.status === 'proposed') return;

    try {
      Logger.info('AutoEvolutionPipeline', `Resuming evolution for candidate: ${candidate.title}`);
      
      const generationOutput = await this.generator.parseOutput(llmOutput);
      
      if (generationOutput.skip) {
        Logger.info('AutoEvolutionPipeline', `Generation skipped: ${generationOutput.skipReason}`);
        this.updateCandidateStatus(candidate.id, 'rejected');
        return;
      }

      // 7. Validate
      this.updateCandidateStatus(candidate.id, 'validating');
      
      // ★ NEW [v2.0]: Pass original content to validator
      const originalContent = candidate.original_content || undefined;
      const validationResult = await this.validator.validate(
        candidate.target_component || candidate.targetComponent,
        generationOutput,
        originalContent
      );

      if (!validationResult.passed) {
        const errorDetails = validationResult.errors.join('\n');
        await this.recordFailure(candidate, 'validation_error', errorDetails);
        
        // ★ NEW [v2.0]: Archive the failure for developer analysis
        await this.gitea.recordFailedTask(candidate, generationOutput, errorDetails);
        return;
      }

      // 8. Create Gitea Proposal
      this.updateCandidateStatus(candidate.id, 'proposed');
      const proposal = await this.gitea.createProposal(
        candidate, 
        generationOutput, 
        candidate.repository || 'AIMindMesh',
        validationResult.warnings
      );

    // 9. Persist proposal to DB
    db.prepare(`
      INSERT INTO evolution_proposals
        (id, candidate_id, title, explanation, branch_name, pr_url, pr_number, repository,
         target_component, impact, breaking_change, commit_hash, created_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      proposal.id, candidate.id, candidate.title, generationOutput.explanation,
      proposal.branchName, proposal.prUrl, proposal.prNumber, candidate.repository || 'AIMindMesh', candidate.target_component || candidate.targetComponent,
      generationOutput.estimatedImpact, generationOutput.breakingChange ? 1 : 0,
      proposal.commitHash, Date.now(), 'proposed'
    );

    // 10. Notifications
    FeedManager.addItem({
      type: 'SYSTEM',
      content: `🧬 **Auto-evolution Proposal**: ${candidate.title}\n\n${generationOutput.explanation}`,
      created_at: Date.now()
    });

    await FCMDispatcher.sendToDevice(config.fcm?.testToken || '', {
      title: '🧬 Auto-improvement ready',
      body: candidate.title,
      data: {
        type: 'EVOLUTION_PROPOSAL',
        proposalId: proposal.id,
        screen: 'EvolutionReview'
      }
    });

    // 11. Mark Neo4j node as processed
    if (candidate.source_id || candidate.sourceId) {
      const session = getSession();
      try {
        await session.run(
          `MATCH (i:Insight) WHERE id(i) = $id SET i.processed = true`,
          { id: parseInt(candidate.source_id || candidate.sourceId) }
        );
      } catch (e) {
        Logger.warn('AutoEvolutionPipeline', `Failed to mark Neo4j node as processed`);
      } finally {
        await session.close();
      }
    }

    Logger.info('AutoEvolutionPipeline', `Proposal successfully created: ${proposal.prUrl}`);
    } catch (err: any) {
      Logger.error('AutoEvolutionPipeline', `Evolution process failed for candidate [${candidate.id}]: ${err.message}`);
      await this.recordFailure(candidate, 'process_error', err.message);
    }
  }

  private persistCandidate(c: any) {
    db.prepare(`
      INSERT OR IGNORE INTO evolution_candidates 
        (id, source, source_id, title, description, repository, target_component, target_language, severity, confidence, proposed_approach, tags, affected_components, change_scope, created_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      c.id, c.source, c.sourceId, c.title, c.description, c.repository || 'AIMindMesh', c.targetComponent, 
      c.targetLanguage, c.severity, c.confidence, c.proposedApproach, 
      typeof c.tags === 'string' ? c.tags : JSON.stringify(c.tags), 
      JSON.stringify(c.affectedComponents || []),
      c.changeScope || 'single_file',
      c.createdAt, c.status
    );
  }

  private updateCandidateStatus(id: string, status: ImprovementCandidate['status']) {
    db.prepare(`UPDATE evolution_candidates SET status = ? WHERE id = ?`).run(status, id);
  }

  private async recordFailure(candidate: any, reason: string, details: string) {
    db.prepare(`
      INSERT INTO evolution_attempts (candidate_id, failure_reason, details, created_at)
      VALUES (?,?,?,?)
    `).run(candidate.id, reason, details, Date.now());
    this.updateCandidateStatus(candidate.id, 'failed');
    Logger.error('AutoEvolutionPipeline', `Task failed: ${reason}`, { details });
  }

  /**
   * Rigenera il codice di una proposta esistente tenendo conto del feedback del developer.
   */
  public async regenerateFromFeedback(
    proposalId: string,
    options?: { routing?: string; model?: string }
  ): Promise<void> {
    const proposal = db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`)
      .get(proposalId) as any;
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
    if (proposal.status === 'merged') throw new Error(`Cannot regenerate a merged proposal`);

    const { feedbackService } = await import('./FeedbackService');

    // Verifica limite iterazioni
    if (!feedbackService.canIterate(proposalId)) {
      Logger.warn('AutoEvolutionPipeline',
        `Proposal ${proposalId} reached max feedback iterations. Marking as iteration_limit.`
      );
      db.prepare(`UPDATE evolution_proposals SET feedback_status = 'iteration_limit' WHERE id = ?`)
        .run(proposalId);
      await this.gitea.addPullRequestComment(
        proposal.pr_number,
        proposal.repository ?? 'AIMindMesh',
        `⚠️ **Maximum iterations reached.** This proposal has been revised the maximum number of times. ` +
        `Please merge, reject, or escalate for manual review.`
      );
      return;
    }

    // Carica il candidato originale
    const candidate = db.prepare(`SELECT * FROM evolution_candidates WHERE id = ?`)
      .get(proposal.candidate_id) as any;
    if (!candidate) throw new Error(`Candidate ${proposal.candidate_id} not found`);

    const pendingFeedbacks = feedbackService.getUnappliedFeedback(proposalId);
    if (pendingFeedbacks.length === 0) {
      Logger.info('AutoEvolutionPipeline', `No pending feedback for proposal ${proposalId}, skipping`);
      return;
    }

    Logger.info('AutoEvolutionPipeline',
      `Regenerating proposal ${proposalId} with ${pendingFeedbacks.length} feedback(s)`
    );

    let currentBranchContent: string;
    try {
      currentBranchContent = await this.gitea.getFileContent(
        candidate.target_component || candidate.targetComponent,
        proposal.repository ?? 'AIMindMesh',
        proposal.branch_name
      );
    } catch (e) {
      Logger.warn('AutoEvolutionPipeline', `Could not fetch branch content, falling back to local file`);
      const repoPath = config.autoEvolution?.repoLocalPath ?? '/app';
      const localPath = path.resolve(repoPath, candidate.target_component || candidate.targetComponent);
      currentBranchContent = fs.existsSync(localPath)
        ? fs.readFileSync(localPath, 'utf-8')
        : proposal.modifiedContent ?? '';
    }

    const newIteration = feedbackService.incrementIteration(proposalId);

    try {
      const output = await this.generator.generateWithFeedback(
        candidate,
        pendingFeedbacks,
        newIteration,
        currentBranchContent,
        options
      );

      if (output.skip) {
        Logger.info('AutoEvolutionPipeline',
          `Feedback regeneration skipped at iteration ${newIteration}: ${output.skipReason}`
        );
        db.prepare(`UPDATE evolution_proposals SET feedback_status = 'has_feedback' WHERE id = ?`)
          .run(proposalId);
        await this.gitea.addPullRequestComment(
          proposal.pr_number, proposal.repository ?? 'AIMindMesh',
          `⚠️ Unable to regenerate: ${output.skipReason}. Please provide more specific feedback.`
        );
        return;
      }

      const originalContent = candidate.original_content ?? undefined;
      const validationResult = await this.validator.validate(
        candidate.target_component || candidate.targetComponent,
        output,
        originalContent,
        { feedbacks: pendingFeedbacks }
      );

      if (!validationResult.passed) {
        const errSummary = validationResult.errors.join('\n');
        Logger.error('AutoEvolutionPipeline',
          `Feedback iteration ${newIteration} failed validation: ${errSummary}`
        );
        await this.gitea.addPullRequestComment(
          proposal.pr_number, proposal.repository ?? 'AIMindMesh',
          `⚠️ **Iteration ${newIteration} failed validation:**\n\`\`\`\n${errSummary}\n\`\`\`\n` +
          `Please refine your feedback and try again.`
        );
        db.prepare(`UPDATE evolution_proposals SET feedback_status = 'has_feedback' WHERE id = ?`)
          .run(proposalId);
        return;
      }

      await this.gitea.updateProposal(candidate, output, proposal, newIteration);

      db.prepare(`
        UPDATE evolution_proposals
        SET explanation = ?, impact = ?, breaking_change = ?, feedback_status = 'none'
        WHERE id = ?
      `).run(output.explanation, output.estimatedImpact, output.breakingChange ? 1 : 0, proposalId);

      feedbackService.markFeedbackAsApplied(proposalId, newIteration - 1);

      await FCMDispatcher.sendToDevice(config.fcm?.testToken || '', {
        title: `🔄 Iteration ${newIteration} ready`,
        body: `${candidate.title} — Review the updated code`,
        data: {
          type: 'EVOLUTION_ITERATION',
          proposalId,
          iteration: String(newIteration),
          screen: 'EvolutionReview',
        },
      });

      Logger.info('AutoEvolutionPipeline',
        `Feedback iteration ${newIteration} completed for proposal ${proposalId}`
      );

    } catch (err: any) {
      Logger.error('AutoEvolutionPipeline',
        `Feedback regeneration failed at iteration ${newIteration}: ${err.message}`
      );
      db.prepare(`UPDATE evolution_proposals SET feedback_status = 'has_feedback' WHERE id = ?`)
        .run(proposalId);
      await this.gitea.addPullRequestComment(
        proposal.pr_number, proposal.repository ?? 'AIMindMesh',
        `❌ **Iteration ${newIteration} error:** ${err.message}. The previous version is still on the branch.`
      );
    }
  }

  /**
   * Injects a user-driven development request into the pipeline.
   * Recognizes intent, manages Gitea projects, and initiates agentic coding.
   */
  public async injectUserRequest(prompt: string, conversationId: string): Promise<{ success: boolean; message: string; candidateId?: string }> {
    Logger.info('AutoEvolutionPipeline', `Processing user-driven development request: ${prompt.substring(0, 50)}...`);
    
    try {
      // 1. Classify intent
      const intent = await IntentClassifier.classify(prompt);
      
      if (intent.category === 'CHAT') {
        return { success: false, message: 'Intent classified as general chat' };
      }

      // 2. Resolve or Create Project
      let repoName = intent.projectName || 'AIMindMesh';
      if (intent.category === 'NEW_PROJECT') {
        await GiteaService.createRepository(repoName, `User-driven project: ${repoName}`);
      } else {
        // Verify existing project
        const repos = await GiteaService.listUserRepos();
        const exists = repos.some((r: any) => r.name === repoName);
        if (!exists) {
          Logger.warn('AutoEvolutionPipeline', `Project ${repoName} not found, falling back to AIMindMesh`);
          repoName = 'AIMindMesh';
        }
      }

      // 3. Create Manual Candidate
      const title = intent.taskMetadata?.goal || `User Request: ${repoName}`;
      const candidate: ImprovementCandidate = {
        id: ImprovementDetector.generateDeterministicId(`chat:${conversationId}`, title),
        source: 'manual',
        sourceId: `chat:${conversationId}`,
        title: title,
        description: prompt,
        repository: repoName,
        targetComponent: intent.taskMetadata?.targetFiles?.[0] || 'README.md',
        affectedComponents: intent.taskMetadata?.targetFiles || [],
        changeScope: intent.category === 'NEW_PROJECT' ? 'multi_file' : 'single_file',
        targetLanguage: 'typescript',
        severity: 8,
        confidence: 0.9,
        proposedApproach: intent.reasoning,
        tags: ['user-request', repoName],
        createdAt: Date.now(),
        status: 'pending'
      };

      this.persistCandidate(candidate);
      Logger.info('AutoEvolutionPipeline', `User-driven candidate [${candidate.id}] created for project ${repoName}`);

      // 4. Trigger evolution
      // For user requests, we use AGENTIC mode (OpenClaw) for better results
      void this.executeEvolutionForCandidate(candidate, { routing: 'OPENCLAW' });

      return { 
        success: true, 
        message: `I've acknowledged your request for **${repoName}**. I'm starting the development process now.`,
        candidateId: candidate.id 
      };

    } catch (err: any) {
      Logger.error('AutoEvolutionPipeline', `Failed to inject user request: ${err.message}`);
      return { success: false, message: `System error while processing request: ${err.message}` };
    }
  }
}

export const autoEvolutionPipeline = new AutoEvolutionPipeline();
