import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditService } from './shared';
import db from '../../../db/sqlite';
import { VentureScheduler } from '../../../services/organization/venture/VentureScheduler';
import { sessionKeyOf } from '../../../services/organization/venture/VentureBuildRun';
import { parseLastValidation } from '../../../services/organization/venture/agentPrompt';
import { listMilestones } from '../../../services/organization/venture/Milestones';

/** Venture repositories: list, provisioning, development agent, CI bootstrap, validation. */
export async function organizationRepositoriesRoutes(app: FastifyInstance) {
  // --- REPOSITORIES ---
  app.get('/repositories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const repos = db.prepare('SELECT * FROM organization_repositories ORDER BY created_at DESC').all() as any[];
      const enriched = repos.map(repo => ({
        ...repo,
        isEvolving: !!repo.active_run_id,
        sessionKey: sessionKeyOf(repo.repo_name),
        lastValidation: parseLastValidation(repo.last_validation)?.summary ?? null,
        milestones: repo.created_from_idea_id ? listMilestones(repo.created_from_idea_id) : [],
      }));
      return { success: true, repositories: enriched };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Human "develop / unblock": a fresh attempt budget, same lock and daily limit as any run
  app.post('/repositories/:repoId/force-develop', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { repoId } = request.params as { repoId: string };
      const result = VentureScheduler.requestRun(repoId, 'human');
      if (result.started) return reply.status(202).send({ success: true, runId: result.runId });
      const errors: Record<string, [number, string]> = {
        not_found: [404, 'Repository not found'],
        disabled: [409, 'Venture builds are disabled: enable them in the organization build settings first'],
        busy: [409, 'Another development run is in progress'],
        daily_limit: [429, 'Daily limit of development runs reached'],
        blocked: [409, 'The repository is blocked'],
        run_budget: [409, 'The run budget of this venture is spent: raise maxRunsPerVenture in the build settings'],
      };
      const [code, error] = errors[result.reason];
      return reply.status(code).send({ error, reason: result.reason });
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/repositories/:repoId/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoId } = request.params as { repoId: string };
    return VentureScheduler.cancelRun(repoId)
      ? { success: true }
      : reply.status(409).send({ error: 'No development run in progress' });
  });

  app.post('/repositories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { GiteaOrganizationService } = await import('../../../services/organization/GiteaOrganizationService');
      const giteaService = new GiteaOrganizationService();

      const created = await giteaService.createRepository({
        namespace: body.namespace || 'aimindmesh-labs',
        repoName: body.repoName,
        description: body.description || '',
        visibility: body.visibility || 'private',
        bootstrapTemplate: body.bootstrapTemplate || 'node-webapp',
        enableCiCd: !!body.enableCiCd,
      });

      const repoId = db.prepare(`
        INSERT INTO organization_repositories (
          id, repo_name, namespace, gitea_url, created_from_idea_id, created_by_role_id, bootstrap_template, ci_cd_enabled, validation_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `).get(
        new Date().getTime().toString(),
        body.repoName,
        body.namespace || 'aimindmesh-labs',
        created.url,
        body.createdFromIdeaId || null,
        body.createdByRoleId || null,
        body.bootstrapTemplate || 'node-webapp',
        body.enableCiCd ? 1 : 0,
        'pending',
        new Date().toISOString()
      ) as { id: string };

      await auditService.log({
        eventType: 'repo:create',
        actorType: 'human',
        actorId: 'human',
        targetType: 'repository',
        targetId: repoId.id,
        payload: { repoName: body.repoName, url: created.url }
      });

      return { success: true, repository: { id: repoId.id, url: created.url, repoName: body.repoName } };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/repositories/:repoId/bootstrap-ci', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { repoId } = request.params as { repoId: string };
      const repo = db.prepare('SELECT * FROM organization_repositories WHERE id = ?').get(repoId) as any;
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const { CiCdBootstrapService } = await import('../../../services/organization/CiCdBootstrapService');
      const bootstrap = new CiCdBootstrapService();
      const templateContent = bootstrap.generateWorkflow(repo.bootstrap_template as any);

      const { GiteaOrganizationService } = await import('../../../services/organization/GiteaOrganizationService');
      const giteaService = new GiteaOrganizationService();
      const repoFullName = `${repo.namespace}/${repo.repo_name}`;

      await giteaService.bootstrapCi(repoFullName, templateContent);

      db.prepare('UPDATE organization_repositories SET ci_cd_enabled = 1 WHERE id = ?').run(repoId);

      await auditService.log({
        eventType: 'repo:bootstrap-ci',
        actorType: 'system',
        actorId: 'cicd-bootstrap',
        targetType: 'repository',
        targetId: repoId,
        payload: { template: repo.bootstrap_template }
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Background check of the published state: the result appears as lastValidation in GET /repositories
  app.post('/repositories/:repoId/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { repoId } = request.params as { repoId: string };
    const outcome = VentureScheduler.startValidation(repoId);
    if (outcome === 'not_found') return reply.status(404).send({ error: 'Repository not found' });
    if (outcome === 'busy') return reply.status(409).send({ error: 'A development run or validation is in progress' });
    return reply.status(202).send({ success: true, result: { status: 'pending', summary: 'Validation started', logs: [] } });
  });
}
