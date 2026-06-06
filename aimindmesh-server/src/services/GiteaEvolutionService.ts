import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import db from '../db/sqlite';
import { config } from '../config';
import { Logger } from '../utils/Logger';
import { ImprovementCandidate } from './ImprovementDetector';
import { CodeGenerationOutput } from './CodeGenerationTask';

const execAsync = promisify(exec);

export interface EvolutionProposal {
  id: string;
  branchName: string;
  prUrl: string;
  prNumber: number;
  commitHash: string;
}

export class GiteaEvolutionService {
  private readonly baseUrl = process.env.GITEA_URL || '';
  private readonly token = process.env.GITEA_TOKEN;
  private readonly repoOwner = config.autoEvolution?.giteaRepoOwner ?? 'human';
  private readonly developerUsername = config.autoEvolution?.giteaDeveloperUsername ?? 'human';
  private readonly repoPath = config.autoEvolution?.repoLocalPath ?? '/app';

  async createProposal(
    candidate: any,
    output: CodeGenerationOutput,
    repository: string = 'AIMindMesh',
    validationWarnings: string[] = []
  ): Promise<EvolutionProposal> {
    if (!this.token) throw new Error('GITEA_TOKEN not configured');

    const targetComp = candidate.targetComponent || candidate.target_component;
    const sourceId = candidate.sourceId || candidate.source_id;

    const slug = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    const branchName = `feature/auto-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${slug}`;
    const proposalId = uuidv4();

    Logger.info('GiteaEvolutionService', `Creating proposal ${proposalId} on branch ${branchName}`);

    // 1. Create branch from main (or current head)
    await this.createBranch(branchName, repository);

    // 2. Commit modified files via Gitea API
    const commitMessage = `auto(evolution): ${candidate.title}\n\n${output.explanation}\n\nSource: ${candidate.source} / ${sourceId}\nProposal: ${proposalId}`;

    // Commit the main file
    await this.commitFile(branchName, targetComp, output.modifiedFileContent, commitMessage, repository);

    // ★ NEW: Commit additional files
    if (output.additionalFiles && output.additionalFiles.length > 0) {
      for (const addFile of output.additionalFiles) {
        const addCommitMsg = `auto(evolution): update ${addFile.path} — ${addFile.reason}`;
        await this.commitFile(branchName, addFile.path, addFile.content, addCommitMsg, repository);
        Logger.info('GiteaEvolutionService', `Additional file committed: ${addFile.path}`);
      }
    }

    // Commit the test file if present
    if (output.unitTestContent && output.unitTestPath) {
      await this.commitFile(branchName, output.unitTestPath, output.unitTestContent, `auto(evolution): add unit tests for ${candidate.title}`, repository);
    }

    // 3. Get the latest commit hash
    const commitHash = await this.getLatestCommitHash(branchName, repository);

    // 4. Create Pull Request
    const pr = await this.createPullRequest({
      branchName,
      title: `🧬 [Auto] ${candidate.title}`,
      body: this.buildPrBody(candidate, output, proposalId, validationWarnings),
      labels: ['auto-evolution', `impact:${output.estimatedImpact}`],
      reviewers: [this.developerUsername]
    }, repository);


    return {
      id: proposalId,
      branchName,
      prUrl: pr.html_url,
      prNumber: pr.number,
      commitHash
    };
  }

  async getFileContent(
    filePath: string,
    repository: string = 'AIMindMesh',
    branch?: string               // ★ NUOVO — se omesso usa il branch di default
  ): Promise<string> {
    if (!this.token) throw new Error('GITEA_TOKEN not configured');

    const branchParam = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/raw/${filePath}${branchParam}`;
    const headers = { Authorization: `token ${this.token}` };

    try {
      const res = await axios.get(apiUrl, { headers, responseType: 'text' });
      return String(res.data);
    } catch (err: any) {
      Logger.error('GiteaEvolutionService', `Failed to fetch file ${filePath}@${branch ?? 'default'}: ${err.message}`);
      throw new Error(`File not found in Gitea repository ${repository}: ${filePath}`);
    }
  }

  private async createBranch(branchName: string, repository: string): Promise<void> {
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/branches`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };

    // Get default branch (main) sha
    const repoRes = await axios.get(`${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}`, { headers });
    const defaultBranch = (repoRes.data as any).default_branch;

    await axios.post(apiUrl, {
      new_branch_name: branchName,
      old_branch_name: defaultBranch
    }, { headers });
  }

  private async commitFile(branchName: string, filePath: string, content: string, message: string, repository: string): Promise<void> {
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/contents/${filePath}`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    let existingSha: string | undefined;
    try {
      const checkRes = await axios.get(`${apiUrl}?ref=${branchName}`, { headers });
      existingSha = (checkRes.data as any)?.sha;
    } catch (e) { }

    const payload: any = {
      message,
      content: encodedContent,
      branch: branchName
    };
    if (existingSha) payload.sha = existingSha;

    await axios[existingSha ? 'put' : 'post'](apiUrl, payload, { headers });
  }

  private async getLatestCommitHash(branchName: string, repository: string): Promise<string> {
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/branches/${branchName}`;
    const headers = { Authorization: `token ${this.token}` };
    const res = await axios.get(apiUrl, { headers });
    return (res.data as any).commit.id;
  }

  private async createPullRequest(data: { branchName: string, title: string, body: string, labels: string[], reviewers: string[] }, repository: string): Promise<any> {
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/pulls`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };

    const repoRes = await axios.get(`${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}`, { headers });
    const defaultBranch = (repoRes.data as any).default_branch;

    const prRes = await axios.post(apiUrl, {
      base: defaultBranch,
      head: data.branchName,
      title: data.title,
      body: data.body,
      labels: [],
      assignees: [data.reviewers[0]]
    }, { headers });

    return prRes.data;
  }

  private buildPrBody(candidate: any, output: CodeGenerationOutput, proposalId: string, warnings: string[] = []): string {
    const targetComp = candidate.targetComponent || candidate.target_component;
    const sourceId = candidate.sourceId || candidate.source_id;

    const fileList = [
      `- \`${targetComp}\` (primary file)`,
      ...(output.additionalFiles?.map(f => `- \`${f.path}\` — ${f.reason}`) ?? []),
      ...(output.unitTestPath ? [`- \`${output.unitTestPath}\` (unit tests)`] : [])
    ].join('\n');

    const warningsSection = warnings.length > 0
      ? `\n### ⚠️ Validation Warnings\n${warnings.map(w => `- ${w}`).join('\n')}\n`
      : '';

    return `## 🧬 Auto-Evolution Proposal

**Proposal ID:** \`${proposalId}\`
**Source:** ${candidate.source} → \`${sourceId}\`

### 📂 Files Modified
${fileList}

**Impact:** ${output.estimatedImpact} | **Breaking change:** ${output.breakingChange ? '⚠️ YES — review signatures carefully' : '✅ No'}
${warningsSection}

---

## What Changed

${output.explanation}

---

## Review Actions

To approve and merge from the AIMindMesh Admin Panel or Mobile app, use Proposal ID: \`${proposalId}\`

> This PR was generated autonomously by the AIMindMesh Auto-Evolution Engine.
> A human developer must review and approve before merging.
`.trim();
  }


  async mergeProposal(proposalId: string): Promise<void> {
    const proposal = db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`).get(proposalId) as any;
    if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposal ${proposalId} not found or not in proposed state`);

    const repository = proposal.repository || 'AIMindMesh';
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/pulls/${proposal.pr_number}/merge`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };

    await axios.post(apiUrl, {
      Do: 'merge',
      merge_message_field: `Approved by developer: auto(evolution) ${proposal.title}`,
      delete_branch_after_merge: true
    }, { headers });

    db.prepare(`UPDATE evolution_proposals SET status = 'merged', merged_at = ? WHERE id = ?`).run(Date.now(), proposalId);
  }

  async rejectProposal(proposalId: string): Promise<void> {
    const proposal = db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`).get(proposalId) as any;
    if (!proposal || proposal.status !== 'proposed') throw new Error(`Proposal ${proposalId} not found or not in proposed state`);

    const repository = proposal.repository || 'AIMindMesh';
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/pulls/${proposal.pr_number}`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };

    await axios.patch(apiUrl, { state: 'closed' }, { headers });

    db.prepare(`UPDATE evolution_proposals SET status = 'rejected', rejected_at = ? WHERE id = ?`).run(Date.now(), proposalId);
  }

  /**
   * ★ NEW [v2.0]: Records a failed evolution task in a dedicated debug repository
   * for later analysis and learning.
   */
  async recordFailedTask(
    candidate: any,
    output: CodeGenerationOutput,
    errorDetails: string
  ): Promise<void> {
    if (!this.token) return;

    const repository = 'ai-tasks-output';
    const slug = candidate.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    const branchName = `fail/${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${slug}`;

    Logger.info('GiteaEvolutionService', `Recording failed task ${candidate.id} in ${repository} on branch ${branchName}`);

    try {
      // 1. Create branch
      await this.createBranch(branchName, repository);

      // 2. Create README with error details
      const readme = `
# ❌ Failed Evolution: ${candidate.title}

**Candidate ID:** \`${candidate.id}\`
**Status:** \`${candidate.status}\`
**Created At:** ${new Date(candidate.created_at || Date.now()).toISOString()}

## 🚨 Error Details
\`\`\`
${errorDetails}
\`\`\`

## 📝 Candidate Description
${candidate.description}

## 💡 Proposed Approach
${candidate.proposed_approach || candidate.proposedApproach}

## 🤖 LLM Explanation
${output.explanation}
`.trim();

      await this.commitFile(branchName, 'README.md', readme, `fail: record error for ${candidate.id}`, repository);

      // 3. Commit the "bad" code for analysis
      const targetComp = candidate.target_component || candidate.targetComponent;
      await this.commitFile(branchName, targetComp, output.modifiedFileContent, `fail: modified code for ${candidate.id}`, repository);

      if (output.additionalFiles && output.additionalFiles.length > 0) {
        for (const addFile of output.additionalFiles) {
          await this.commitFile(branchName, addFile.path, addFile.content, `fail: additional code for ${addFile.path}`, repository);
        }
      }

      Logger.info('GiteaEvolutionService', `Successfully recorded failure in ${repository}`);
    } catch (err: any) {
      Logger.error('GiteaEvolutionService', `Failed to record task failure in debug repo: ${err.message}`);
    }
  }

  // ── PR Feedback Loop Methods (v3.0) ───────────────────────────────────────

  /**
   * Recupera i commenti di un PR Gitea.
   */
  async getPullRequestComments(prNumber: number, repository: string): Promise<Array<{
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
  }>> {
    if (!this.token) return [];
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/issues/${prNumber}/comments`;
    const headers = { Authorization: `token ${this.token}` };
    try {
      const res = await axios.get(apiUrl, { headers });
      return res.data as any[];
    } catch (e) {
      Logger.warn('GiteaEvolutionService', `Failed to fetch PR comments for #${prNumber}: ${e}`);
      return [];
    }
  }

  /**
   * Aggiunge un commento automatico al PR.
   */
  async addPullRequestComment(prNumber: number, repository: string, body: string): Promise<void> {
    if (!this.token) return;
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/issues/${prNumber}/comments`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };
    try {
      await axios.post(apiUrl, { body }, { headers });
    } catch (e) {
      Logger.warn('GiteaEvolutionService', `Failed to add comment to PR #${prNumber}: ${e}`);
    }
  }

  /**
   * Aggiorna il body di un PR esistente.
   */
  async updatePullRequestBody(prNumber: number, repository: string, newBody: string): Promise<void> {
    if (!this.token) return;
    const apiUrl = `${this.baseUrl}/api/v1/repos/${this.repoOwner}/${repository}/pulls/${prNumber}`;
    const headers = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };
    try {
      await axios.patch(apiUrl, { body: newBody }, { headers });
    } catch (e) {
      Logger.warn('GiteaEvolutionService', `Failed to update PR body for #${prNumber}: ${e}`);
    }
  }

  /**
   * Aggiorna una proposta esistente dopo feedback.
   */
  async updateProposal(
    candidate: any,
    output: CodeGenerationOutput,
    proposal: any,
    iterationCount: number
  ): Promise<void> {
    if (!this.token) throw new Error('GITEA_TOKEN not configured');

    const targetComp = candidate.targetComponent || candidate.target_component;
    const repository = proposal.repository || 'AIMindMesh';
    const branchName = proposal.branch_name;
    const prNumber = proposal.pr_number;

    const commitMessage =
      `auto(evolution): iteration ${iterationCount} — ${candidate.title}\n\n` +
      `${output.explanation}\n\nProposal: ${proposal.id}`;

    Logger.info('GiteaEvolutionService', `Updating proposal ${proposal.id} — iteration ${iterationCount}`);

    await this.commitFile(branchName, targetComp, output.modifiedFileContent, commitMessage, repository);

    for (const addFile of output.additionalFiles ?? []) {
      if (!addFile.path || !addFile.content) continue;
      const msg = `auto(evolution): update ${addFile.path} (iter ${iterationCount}) — ${addFile.reason}`;
      await this.commitFile(branchName, addFile.path, addFile.content, msg, repository);
    }

    if (output.unitTestContent && output.unitTestPath) {
      await this.commitFile(
        branchName, output.unitTestPath, output.unitTestContent,
        `auto(evolution): update tests (iter ${iterationCount})`, repository
      );
    }

    const updatedBody = this.buildIteratedPrBody(candidate, output, proposal.id, iterationCount);
    await this.updatePullRequestBody(prNumber, repository, updatedBody);

    await this.addPullRequestComment(prNumber, repository,
      `🔄 **Iteration ${iterationCount}** — Code regenerated based on developer feedback.\n\n` +
      `**Changes in this iteration:**\n${output.explanation}\n\n` +
      `_Waiting for review. Reply with comments to trigger another iteration (max ${config.autoEvolution?.maxFeedbackIterations ?? 5
      } iterations)._`
    );
  }

  private buildIteratedPrBody(
    candidate: any,
    output: CodeGenerationOutput,
    proposalId: string,
    iterationCount: number
  ): string {
    const targetComp = candidate.targetComponent || candidate.target_component;
    const fileList = [
      `- \`${targetComp}\` — primary target`,
      ...(output.additionalFiles?.map(f => `- \`${f.path}\` — ${f.reason}`) ?? []),
      ...(output.unitTestPath ? [`- \`${output.unitTestPath}\` — unit tests`] : []),
    ].join('\n');

    return `## 🧬 Auto-Evolution Proposal
**Proposal ID:** \`${proposalId}\`
**Iteration:** ${iterationCount} / ${config.autoEvolution?.maxFeedbackIterations ?? 5}
**Impact:** ${output.estimatedImpact} | **Breaking change:** ${output.breakingChange ? '⚠️ YES' : '✅ No'}

---

## Files Modified
${fileList}

---

## What Changed (Latest Iteration)
${output.explanation}

---

## Review Instructions
- ✅ To approve: merge this PR from the Admin Panel (Proposal ID: \`${proposalId}\`)
- 💬 To improve: leave a comment on this PR — the system will regenerate automatically
- ❌ To reject: close the PR without merging

> Generated by AIMindMesh Auto-Evolution Engine. Human review required before merging.
`.trim();
  }

  /**
   * Sincronizza i commenti Gitea di un PR verso evolution_feedback.
   */
  async syncPrCommentsToFeedback(proposalId: string): Promise<number> {
    const proposal = db.prepare(`SELECT * FROM evolution_proposals WHERE id = ?`).get(proposalId) as any;
    if (!proposal) return 0;

    const comments = await this.getPullRequestComments(proposal.pr_number, proposal.repository ?? 'AIMindMesh');
    let imported = 0;

    for (const comment of comments) {
      const existing = db.prepare(`
        SELECT 1 FROM evolution_feedback
        WHERE proposal_id = ? AND source = 'gitea_comment' AND author = ?
      `).get(proposalId, `gitea:${comment.id}`);

      if (!existing) {
        const { feedbackService } = await import('./FeedbackService');
        await feedbackService.ingestGiteaComment(
          proposalId,
          comment.body,
          comment.user.login
        );
        db.prepare(`
          UPDATE evolution_feedback SET author = ? WHERE proposal_id = ? AND source = 'gitea_comment'
          AND created_at = (SELECT MAX(created_at) FROM evolution_feedback WHERE proposal_id = ?)
        `).run(`gitea:${comment.id}`, proposalId, proposalId);
        imported++;
      }
    }

    return imported;
  }
}
