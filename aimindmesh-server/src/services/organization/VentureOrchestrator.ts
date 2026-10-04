import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';
import { OrganizationAuditService } from './OrganizationAuditService';
import { extractDirectivesFromSynthesis, hasIdeaDirectives } from './venture/DirectiveExtractor';
import { VentureScheduler } from './venture/VentureScheduler';

/**
 * Turns a characterized idea into a venture repository and hands it to the build loop.
 *
 * The server provisions the Gitea repository and commits the specification; development runs,
 * validation and pushes belong to VentureScheduler. No Gitea CI or webhook is bootstrapped:
 * validation happens on the server.
 */
export class VentureOrchestrator {
  public static async onIdeaCharacterized(ideaId: string): Promise<void> {
    const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
    if (!ideaRow) {
      Logger.warn('VentureOrchestrator', `Idea ${ideaId} not found in database.`);
      return;
    }
    const designRow = db.prepare('SELECT * FROM organization_product_designs WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as any;
    if (!designRow) {
      Logger.warn('VentureOrchestrator', `Design for Idea ${ideaId} not found in database.`);
      return;
    }

    // 1. Directives from the council recommendations, scoped to this idea
    if (ideaRow.analysis_synthesis && !hasIdeaDirectives(ideaId)) {
      try {
        const created = await extractDirectivesFromSynthesis(ideaRow, ideaRow.analysis_synthesis);
        Logger.info('VentureOrchestrator', `Generated ${created.length} directives for "${ideaRow.title}"`);
      } catch (err: any) {
        Logger.error('VentureOrchestrator', `Directive extraction failed for "${ideaRow.title}": ${err.message}`);
      }
    }

    // 2. Repository with the specification
    let repo = db.prepare('SELECT id FROM organization_repositories WHERE created_from_idea_id = ?').get(ideaId) as { id: string } | undefined;
    if (!repo) {
      try {
        repo = await this.provisionRepository(ideaRow, designRow.raw_markdown);
      } catch (err: any) {
        Logger.error('VentureOrchestrator', `Repository provisioning failed for "${ideaRow.title}": ${err.message}`);
        return;
      }
    }
    db.prepare(`UPDATE organization_ideas SET status = 'development', updated_at = ? WHERE id = ? AND status IN ('approved', 'characterized')`)
      .run(new Date().toISOString(), ideaId);

    // 3. First development run (waits in `pending` while builds are disabled or busy)
    const result = VentureScheduler.requestRun(repo.id, 'system');
    if (!result.started) Logger.info('VentureOrchestrator', `First run of "${ideaRow.title}" deferred: ${result.reason}`);
  }

  private static async provisionRepository(ideaRow: any, specification: string): Promise<{ id: string }> {
    const namespace = config.organization?.defaultGiteaNamespace || 'aimindmesh-labs';
    const slug = String(ideaRow.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '').slice(0, 60)
      || `project-${String(ideaRow.id).substring(0, 8)}`;

    const { GiteaOrganizationService } = await import('./GiteaOrganizationService');
    const created = await new GiteaOrganizationService().createRepository({
      namespace,
      repoName: slug,
      description: `Venture: ${ideaRow.title}`,
      visibility: config.organization?.defaultRepoVisibility === 'public' ? 'public' : 'private',
      bootstrapTemplate: 'node-webapp',
      enableCiCd: false,
    });

    const repoId = Date.now().toString();
    db.prepare(`
      INSERT INTO organization_repositories (
        id, repo_name, namespace, gitea_url, created_from_idea_id, bootstrap_template, ci_cd_enabled, validation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'node-webapp', 0, 'pending', ?)
    `).run(repoId, slug, namespace, created.url, ideaRow.id, new Date().toISOString());

    await new OrganizationAuditService().log({
      eventType: 'repo:create',
      actorType: 'system',
      actorId: 'venture-orchestrator',
      targetType: 'repository',
      targetId: repoId,
      payload: { repoName: slug, url: created.url, autoCreatedFromIdea: ideaRow.id },
    });

    const { GiteaService } = await import('../GiteaService');
    const committed = await GiteaService.commitFile(`${namespace}/${slug}`, 'TECHNICAL_SPECIFICATION.md', specification,
      'Add initial technical specification from Characterization phase');
    if (!committed) Logger.warn('VentureOrchestrator', `TECHNICAL_SPECIFICATION.md could not be committed to ${namespace}/${slug}`);

    Logger.info('VentureOrchestrator', `Created repository ${namespace}/${slug} for: ${ideaRow.title}`);
    return { id: repoId };
  }

  /**
   * Handle an incoming Gitea CI/CD webhook event.
   * Records the CI outcome only: the venture status (healthy, broken, blocked) is decided by the
   * server-side validation, never by a workflow the repository itself can change.
   */
  public static handleCiWebhook(payload: any): void {
    try {
      const repoName = payload.repository?.name as string | undefined;
      const conclusion = payload.workflow_run?.conclusion || payload.check_run?.conclusion;
      const status = payload.workflow_run?.status || payload.check_run?.status;
      if (!repoName || status !== 'completed') return;

      const repo = db.prepare(`SELECT id FROM organization_repositories WHERE repo_name = ?`).get(repoName) as any;
      if (!repo) return;
      db.prepare(`UPDATE organization_repositories SET last_ci_status = ?, last_ci_at = ? WHERE id = ?`)
        .run(conclusion ?? null, new Date().toISOString(), repo.id);
      Logger.info('VentureOrchestrator', `CI webhook: repo "${repoName}" CI ${conclusion}`);
    } catch (err: any) {
      Logger.error('VentureOrchestrator', `CI webhook handling error: ${err.message}`);
    }
  }
}
