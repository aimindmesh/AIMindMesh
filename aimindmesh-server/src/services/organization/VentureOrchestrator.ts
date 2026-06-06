import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { InferenceRouter } from '../InferenceRouter';

// ─────────────────────────────────────────────────────────────────────────────
// Healing Prompt — injected at the top of EVERY agent task for a venture repo
// ─────────────────────────────────────────────────────────────────────────────
// Healing Prompt — injected at the top of EVERY agent task for a venture repo
// ─────────────────────────────────────────────────────────────────────────────
const HEALING_PREAMBLE = `
## ⚠️ MANDATORY PRE-FLIGHT INTEGRITY CHECK (execute FIRST, before ANY coding)

You are working on a Gitea repository. Previous agent sessions may have left
partial or empty files. Before writing a single line of code you MUST:

1. Run: git status
2. Detect empty source files:
   find . \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) -not -path "*/node_modules/*" | xargs -I{} sh -c \'test -s "{}" || echo "EMPTY: {}"\'
3. If ANY empty/partial files are found:
   a. Run: git log --oneline -5   (inspect last commits)
   b. If the repo has at least one commit: git reset --hard HEAD
   c. If the repo has NO commits yet (empty): rm -rf src && rm -f package.json tsconfig.json (start fresh)
4. Verify the workspace is clean and coherent before proceeding.

## ⚠️ SPEC-FIRST DEVELOPMENT PARADIGM

Your development workflow must strictly follow a specs-first approach:
1. **Understand Requisites**: Analyze the debate synthesis and directives.
2. **Draft Technical Specification**: Before writing ANY business logic, write a comprehensive \`TECHNICAL_SPECIFICATION.md\` in the root directory. It must specify details on system architecture, endpoints, database schema, and test strategies.
3. **Phased Implementation**: Implement modular files sequentially following the spec.

## ⚠️ STABILITY & STUB LAWS (STRICT LAWS)
- **NO PLACEHOLDERS OR STUBS**: Writing stub code, half-implemented functions, mock data arrays, or comments like \`// TODO: implement later\` or \`// logic goes here\` is STRICTLY PROHIBITED. All functions, classes, and handlers must be fully written and operational.
- **WRITE TESTS**: Create comprehensive unit/integration test files to validate logic correctness.

## ⚠️ SANDBOX KASM RUNTIME VALIDATION (execute after a successful build)

You have access to a full sandbox container (Kasm workspace) inside the VPN. You MUST run and test your software inside the sandbox.
After completing all code:
1. Run: npm install
2. Run: npm run build (or equivalent compile commands for the project template)
3. Start the application: npm start & (or npm run dev &)
4. Wait 5 seconds, then check the process is still running: pgrep -f node
5. Validate code behavior manually or with scripts. Fix any crashes, lint errors, or typescript warnings before staging.
6. Once stable, commit and push to Gitea.

---
`;

// Stale threshold: repos stuck in "evolving" for more than 90 minutes
// with no active OpenClaw session are considered stale and auto-retriggered.
const STALE_THRESHOLD_MS = 90 * 60 * 1000;

export class VentureOrchestrator {
  public static async onIdeaApproved(ideaId: string): Promise<void> {
    try {
      Logger.info('VentureOrchestrator', `Processing approved idea: ${ideaId}`);

      // 1. Retrieve the idea details
      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        Logger.warn('VentureOrchestrator', `Idea ${ideaId} not found in database.`);
        return;
      }

      // 2. Automatically generate directives from recommendations
      const synthesis = ideaRow.analysis_synthesis;
      if (synthesis) {
        try {
          const createdByTag = `system:council-debate:${ideaId}`;
          const hasDirectives = db.prepare("SELECT id FROM organization_directives WHERE created_by = ?").get(createdByTag);

          if (!hasDirectives) {
            Logger.info('VentureOrchestrator', `Auto-extracting directives from debate synthesis for "${ideaRow.title}"`);
            const prompt = `You are a Strategic Director. Analyze the following Council Debate Synthesis for the idea "${ideaRow.title}".
Problem Statement: ${ideaRow.problem_statement || ''}
Debate Synthesis:
${synthesis}

Your task is to extract the key actionable recommendations/concerns and formulate them into active Strategic Directives to resolve the issues.
Generate a JSON array of directives, and ONLY the JSON array (no markdown wraps, no extra text, just the raw JSON array).
Format:
[
  {
    "title": "Short descriptive title (max 60 chars)",
    "description": "Clear actionable description of what to explore, build, improve, or check",
    "goalType": "explore" | "build" | "improve" | "stop" | "pivot" | "research",
    "priority": 1-100,
    "constraints": { "key": "value" }
  }
]`;

            const responseText = await InferenceRouter.complete(prompt, 'DIRECTIVES_EXTRACTION', {
              taskName: `Extracting directives for: ${ideaRow.title}`
            });

            let cleanJson = responseText.trim();
            if (cleanJson.startsWith('```json')) cleanJson = cleanJson.slice(7);
            if (cleanJson.startsWith('```')) cleanJson = cleanJson.slice(3);
            if (cleanJson.endsWith('```')) cleanJson = cleanJson.slice(0, -3);
            cleanJson = cleanJson.trim();

            const items = JSON.parse(cleanJson);
            const { SQLiteDirectiveRepository, DirectiveService } = await import('./DirectiveService');
            const repo = new SQLiteDirectiveRepository();
            const directiveService = new DirectiveService(repo);

            for (const item of items) {
              await directiveService.createDirective({
                title: item.title,
                description: item.description,
                goalType: item.goalType || 'research',
                constraints: item.constraints || {},
                priority: Number(item.priority) || 50,
                createdBy: createdByTag,
              });
            }
            Logger.info('VentureOrchestrator', `Automatically generated ${items.length} directives from synthesis for: ${ideaRow.title}`);
          } else {
            Logger.info('VentureOrchestrator', `Directives already generated for idea ${ideaId}. Skipping.`);
          }
        } catch (err: any) {
          Logger.error('VentureOrchestrator', `Auto-generating directives failed: ${err.message}`);
        }
      }

      // 3. Automatically create/provision Gitea repository for this idea
      let repoUrl = '';
      let repoName = '';
      let repoId = '';

      try {
        const slug = ideaRow.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');

        const existingRepo = db.prepare('SELECT id, repo_name, gitea_url FROM organization_repositories WHERE created_from_idea_id = ?').get(ideaId) as any;
        const namespace = 'aimindmesh-labs';

        if (!existingRepo) {
          const { GiteaOrganizationService } = await import('./GiteaOrganizationService');
          const giteaService = new GiteaOrganizationService();

          repoName = slug || `project-${ideaId.substring(0, 8)}`;
          Logger.info('VentureOrchestrator', `Creating repository ${namespace}/${repoName} for: ${ideaRow.title}`);

          const created = await giteaService.createRepository({
            namespace,
            repoName,
            description: `Automated repository for approved venture idea: ${ideaRow.title}`,
            visibility: 'private',
            bootstrapTemplate: 'node-webapp',
            enableCiCd: true,
          });

          repoUrl = created.url;
          repoId = new Date().getTime().toString();

          db.prepare(`
            INSERT INTO organization_repositories (
              id, repo_name, namespace, gitea_url, created_from_idea_id, bootstrap_template, ci_cd_enabled, validation_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            repoId,
            repoName,
            namespace,
            repoUrl,
            ideaId,
            'node-webapp',
            1,
            'pending',
            new Date().toISOString()
          );

          const { OrganizationAuditService } = await import('./OrganizationAuditService');
          const auditService = new OrganizationAuditService();
          await auditService.log({
            eventType: 'repo:create',
            actorType: 'system',
            actorId: 'venture-orchestrator',
            targetType: 'repository',
            targetId: repoId,
            payload: { repoName, url: repoUrl, autoCreatedFromIdea: ideaId }
          });

          Logger.info('VentureOrchestrator', `Automatically created repository ${namespace}/${repoName} for: ${ideaRow.title}`);

          // 4. Bootstrap CI/CD workflow
          try {
            const defaultWorkflow = `name: Build and Validate\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - name: Use Node.js\n        uses: actions/setup-node@v3\n        with:\n          node-version: 18\n      - run: npm install\n      - run: npm run build --if-present\n      - run: npm test --if-present\n`;
            await giteaService.bootstrapCi(`${namespace}/${repoName}`, defaultWorkflow);
            db.prepare('UPDATE organization_repositories SET ci_cd_enabled = 1 WHERE id = ?').run(repoId);
            Logger.info('VentureOrchestrator', `Automatically bootstrapped CI/CD for ${namespace}/${repoName}`);
          } catch (ciErr: any) {
            Logger.error('VentureOrchestrator', `Auto-bootstrapping CI/CD failed: ${ciErr.message}`);
          }

          // 5. Register Gitea webhook → server (for CI/CD event feedback)
          try {
            await giteaService.registerWebhook(namespace, repoName);
            Logger.info('VentureOrchestrator', `Registered Gitea webhook for ${namespace}/${repoName}`);
          } catch (whErr: any) {
            Logger.warn('VentureOrchestrator', `Webhook registration failed (non-fatal): ${whErr.message}`);
          }
        } else {
          repoId = existingRepo.id;
          repoName = existingRepo.repo_name;
          repoUrl = existingRepo.gitea_url;
          Logger.info('VentureOrchestrator', `Repository already exists for idea ${ideaId}. Using existing URL: ${repoUrl}`);
        }

        // 6. Trigger development agent
        await VentureOrchestrator.triggerDevelopmentAgent(repoId, repoName, repoUrl, ideaRow, synthesis);

      } catch (repoErr: any) {
        Logger.error('VentureOrchestrator', `Auto-provisioning repository failed: ${repoErr.message}`);
      }
    } catch (err: any) {
      Logger.error('VentureOrchestrator', `Unexpected orchestration error: ${err.message}`);
    }
  }

  /**
   * Triggers (or resumes) the OpenClaw development agent for a given repository.
   * Applies the healing preamble and Kasm validation instructions.
   */
  public static async triggerDevelopmentAgent(
    repoId: string,
    repoName: string,
    repoUrl: string,
    ideaRow: any,
    synthesis: string | null,
  ): Promise<void> {
    try {
      const { SQLiteDirectiveRepository } = await import('./DirectiveService');
      const dirRepo = new SQLiteDirectiveRepository();
      const activeDirs = await dirRepo.findActive();
      const directivesText = activeDirs
        .map(d => `- [${d.goalType.toUpperCase()}] ${d.title}: ${d.description}`)
        .join('\n');

      const slug = repoName;
      const sessionKey = `develop-${slug}`;

      const gitUrl = process.env.GITEA_TOKEN
        ? repoUrl.replace('http://', `http://token:${process.env.GITEA_TOKEN}@`)
        : repoUrl;

      const { runAgentTask: runOpenClawTask, getSessionHistory } = await import('../OpenClawBridge');

      // Check for existing session (resume logic)
      let isExistingSession = false;
      try {
        const history = await getSessionHistory(sessionKey);
        if (history && history.length > 0) {
          isExistingSession = true;
        }
      } catch (e: any) {
        Logger.warn('VentureOrchestrator', `Failed to check session history: ${e.message}`);
      }

      const developmentTask = isExistingSession
        ? `Please resume development for "${ideaRow.title}".
Your previous session was interrupted. Resume from where you left off.
Repository: ${gitUrl}
Current Strategic Directives:
${directivesText}`
        : `We have approved a new venture idea: "${ideaRow.title}"
Problem Statement: ${ideaRow.problem_statement || ''}
Debate Synthesis: ${synthesis || ''}

A Git repository has been provisioned at: ${gitUrl}

Current Strategic Directives:
${directivesText}

Please begin development. Initialize the project inside the repository, build the core functionalities, and push the code back to Gitea.`;

      // Compose final prompt: healing preamble + actual task
      const agentPrompt = HEALING_PREAMBLE + developmentTask;

      // Mark repo as "evolving" and stamp last trigger time
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE organization_repositories SET validation_status = 'evolving', agent_last_triggered_at = ? WHERE id = ?`
      ).run(now, repoId);

      Logger.info('VentureOrchestrator', `Triggering OpenClaw Agent (resume=${isExistingSession}) for: ${ideaRow.title}`);

      runOpenClawTask(agentPrompt, sessionKey).then(() => {
        // Mark as needs_verification when agent task completes
        db.prepare(
          `UPDATE organization_repositories SET validation_status = 'needs_verification' WHERE id = ? AND validation_status = 'evolving'`
        ).run(repoId);
        Logger.info('VentureOrchestrator', `Agent task completed for ${repoName}. Status → needs_verification`);
      }).catch((e: any) => {
        Logger.error('VentureOrchestrator', `OpenClaw Agent execution failed: ${e.message}`);
        // Don't reset status — watchdog will detect stale state and retry
      });

    } catch (agentErr: any) {
      Logger.error('VentureOrchestrator', `Failed to trigger development agents: ${agentErr.message}`);
    }
  }

  /**
   * Watchdog: scans repos stuck in "evolving" state with no active OpenClaw session
   * for longer than STALE_THRESHOLD_MS and auto-retriggers them.
   * Should be called at server startup and periodically (e.g. every 30 min).
   */
  public static async runWatchdog(): Promise<void> {
    Logger.info('VentureOrchestrator', 'Running stale session watchdog...');
    try {
      const { isSessionActive } = await import('../OpenClawBridge');

      const staleThresholdIso = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
      const staleRepos = db.prepare(`
        SELECT r.*, i.title, i.problem_statement, i.analysis_synthesis
        FROM organization_repositories r
        LEFT JOIN organization_ideas i ON r.created_from_idea_id = i.id
        WHERE r.validation_status = 'evolving'
          AND (r.agent_last_triggered_at IS NULL OR r.agent_last_triggered_at < ?)
      `).all(staleThresholdIso) as any[];

      if (staleRepos.length === 0) {
        Logger.info('VentureOrchestrator', 'Watchdog: no stale repos found.');
        return;
      }

      for (const repo of staleRepos) {
        const sessionKey = `develop-${repo.repo_name}`;
        const active = isSessionActive(sessionKey);

        if (!active) {
          Logger.warn('VentureOrchestrator', `Watchdog: repo "${repo.repo_name}" is stale (last triggered: ${repo.agent_last_triggered_at}). Re-triggering...`);
          try {
            const ideaRow = {
              title: repo.title || repo.repo_name,
              problem_statement: repo.problem_statement || '',
              analysis_synthesis: repo.analysis_synthesis || '',
            };
            await VentureOrchestrator.triggerDevelopmentAgent(
              repo.id,
              repo.repo_name,
              repo.gitea_url,
              ideaRow,
              repo.analysis_synthesis,
            );
          } catch (retriggerErr: any) {
            Logger.error('VentureOrchestrator', `Watchdog: failed to re-trigger ${repo.repo_name}: ${retriggerErr.message}`);
          }
        } else {
          Logger.info('VentureOrchestrator', `Watchdog: repo "${repo.repo_name}" session is still active — updating timestamp.`);
          db.prepare(`UPDATE organization_repositories SET agent_last_triggered_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), repo.id);
        }
      }
    } catch (err: any) {
      Logger.error('VentureOrchestrator', `Watchdog error: ${err.message}`);
    }
  }

  /**
   * Handle an incoming Gitea CI/CD webhook event.
   * Updates the DB repo status based on workflow run result.
   */
  public static handleCiWebhook(payload: any): void {
    try {
      // Gitea sends workflow_run events with conclusion: success | failure | cancelled
      const repoName = payload.repository?.name as string | undefined;
      const conclusion = payload.workflow_run?.conclusion || payload.check_run?.conclusion;
      const status = payload.workflow_run?.status || payload.check_run?.status;

      if (!repoName) return;

      const repo = db.prepare(`SELECT id FROM organization_repositories WHERE repo_name = ?`).get(repoName) as any;
      if (!repo) return;

      const now = new Date().toISOString();
      let validationStatus: string | null = null;

      if (status === 'completed') {
        validationStatus = conclusion === 'success' ? 'healthy' : 'broken';
      }

      if (validationStatus) {
        db.prepare(`UPDATE organization_repositories SET validation_status = ?, last_ci_status = ?, last_ci_at = ? WHERE id = ?`)
          .run(validationStatus, conclusion, now, repo.id);
        Logger.info('VentureOrchestrator', `CI webhook: repo "${repoName}" → ${validationStatus} (conclusion: ${conclusion})`);
      }
    } catch (err: any) {
      Logger.error('VentureOrchestrator', `CI webhook handling error: ${err.message}`);
    }
  }
}
