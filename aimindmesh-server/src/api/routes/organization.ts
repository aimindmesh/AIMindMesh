import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SQLiteOrganizationRoleRepository, OrganizationRegistry } from '../../services/organization/OrganizationRegistry';
import { RoleLifecycleService } from '../../services/organization/RoleLifecycleService';
import { SQLiteDirectiveRepository, DirectiveService } from '../../services/organization/DirectiveService';
import { VentureDiscoveryService } from '../../services/organization/VentureDiscoveryService';
import { OpportunityScoringService } from '../../services/organization/OpportunityScoringService';
import { RolePolicyService } from '../../services/organization/RolePolicyService';
import { OrganizationAuditService } from '../../services/organization/OrganizationAuditService';
import { AutonomousVentureEngine } from '../../services/organization/AutonomousVentureEngine';
import db from '../../db/sqlite';

// Instantiate singletons
const roleRepo = new SQLiteOrganizationRoleRepository();
const registry = new OrganizationRegistry(roleRepo);
const lifecycle = new RoleLifecycleService(roleRepo);

const directiveRepo = new SQLiteDirectiveRepository();
const directiveService = new DirectiveService(directiveRepo);

const auditService = new OrganizationAuditService();
const policyService = new RolePolicyService();
const scoringService = new OpportunityScoringService();

export async function organizationRoutes(app: FastifyInstance) {
  // Health
  app.get('/health', async () => ({ ok: true, service: 'Organization Layer' }));

  // --- ROLES ---
  app.get('/roles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const roles = await registry.listRoles();
      return { success: true, roles };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/roles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const role = await lifecycle.createRole({
        name: body.name,
        description: body.description,
        mission: body.mission,
        systemPrompt: body.systemPrompt,
        providerPreferences: body.providerPreferences || {},
        toolPermissions: body.toolPermissions || [],
        memoryNamespace: body.memoryNamespace || `role:${body.name.toLowerCase().replace(/\s+/g, '-')}`,
        approvalPolicy: body.approvalPolicy || {},
        canRecruit: !!body.canRecruit,
        canProposeRepo: !!body.canProposeRepo,
        canProvisionValidation: !!body.canProvisionValidation,
        createdBy: 'human',
      });

      await auditService.log({
        eventType: 'role:create',
        actorType: 'human',
        actorId: 'human',
        targetType: 'role',
        targetId: role.id,
        payload: { name: role.name }
      });

      return { success: true, role };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.put('/roles/:roleId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { roleId } = request.params as { roleId: string };
      const body = request.body as any;
      const role = await lifecycle.updateRole(roleId, body);

      await auditService.log({
        eventType: 'role:update',
        actorType: 'human',
        actorId: 'human',
        targetType: 'role',
        targetId: roleId,
        payload: body
      });

      return { success: true, role };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.delete('/roles/:roleId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { roleId } = request.params as { roleId: string };
      await lifecycle.archiveRole(roleId);

      await auditService.log({
        eventType: 'role:archive',
        actorType: 'human',
        actorId: 'human',
        targetType: 'role',
        targetId: roleId,
        payload: {}
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- DIRECTIVES ---
  app.get('/directives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const directives = await directiveService.getActiveDirectives();
      return { success: true, directives };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/directives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      if (!DirectiveService.validateGoalType(body.goalType)) {
        return reply.status(400).send({ error: 'Invalid goal type' });
      }

      const directive = await directiveService.createDirective({
        title: body.title,
        description: body.description,
        goalType: body.goalType,
        constraints: body.constraints || {},
        priority: Number(body.priority) || 50,
        createdBy: 'human',
        supersedesId: body.supersedesId || null,
      });

      await auditService.log({
        eventType: 'directive:create',
        actorType: 'human',
        actorId: 'human',
        targetType: 'directive',
        targetId: directive.id,
        payload: { title: directive.title }
      });

      return { success: true, directive };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.delete('/directives/:directiveId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { directiveId } = request.params as { directiveId: string };
      await directiveService.cancelDirective(directiveId);

      await auditService.log({
        eventType: 'directive:cancel',
        actorType: 'human',
        actorId: 'human',
        targetType: 'directive',
        targetId: directiveId,
        payload: {}
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- AUDIT LOGS ---
  app.get('/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const logs = db.prepare('SELECT * FROM organization_audit_log ORDER BY created_at DESC LIMIT 100').all();
      return { success: true, logs };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- IDEAS ---
  app.get('/ideas', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ideas = db.prepare('SELECT * FROM organization_ideas ORDER BY created_at DESC').all();
      const parsedIdeas = ideas.map((row: any) => {
        let synthesis = row.analysis_synthesis || null;
        if (!synthesis) {
          const log = db.prepare(`
            SELECT payload FROM organization_audit_log 
            WHERE event_type = 'idea:review' AND target_id = ? 
            ORDER BY created_at DESC LIMIT 1
          `).get(row.id) as any;
          if (log && log.payload) {
            try {
              const payload = JSON.parse(log.payload);
              synthesis = payload.synthesis || null;
            } catch {}
          }
        }

        return {
          id: row.id,
          title: row.title,
          problemStatement: row.problem_statement || '',
          summary: row.summary || '',
          sourceSignals: JSON.parse(row.source_signals || '[]'),
          strategicScore: row.strategic_score || 0,
          feasibilityScore: row.feasibility_score || 0,
          noveltyScore: row.novelty_score || 0,
          overallScore: row.overall_score || 0,
          status: row.status,
          analysisSynthesis: synthesis,
          humanFeedback: row.human_feedback || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });
      return { success: true, ideas: parsedIdeas };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const ideaId = `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      db.prepare(`
        INSERT INTO organization_ideas (
          id, title, problem_statement, summary, source_signals, strategic_score, feasibility_score, novelty_score, overall_score, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ideaId,
        body.title || 'Untitled Idea',
        body.problemStatement || '',
        body.summary || '',
        JSON.stringify(body.sourceSignals || []),
        Number(body.strategicScore) || 50,
        Number(body.feasibilityScore) || 50,
        Number(body.noveltyScore) || 50,
        Number(body.overallScore) || 50,
        'proposed',
        new Date().toISOString(),
        new Date().toISOString()
      );

      await auditService.log({
        eventType: 'idea:create',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: { title: body.title }
      });

      return {
        success: true,
        idea: {
          id: ideaId,
          title: body.title,
          problemStatement: body.problemStatement || '',
          summary: body.summary || '',
          sourceSignals: body.sourceSignals || [],
          strategicScore: Number(body.strategicScore) || 50,
          feasibilityScore: Number(body.feasibilityScore) || 50,
          noveltyScore: Number(body.noveltyScore) || 50,
          overallScore: Number(body.overallScore) || 50,
          status: 'proposed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.put('/ideas/:ideaId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const body = request.body as any;
      const { title, problemStatement, summary } = body;
      
      const res = db.prepare(`
        UPDATE organization_ideas
        SET title = ?, problem_statement = ?, summary = ?, updated_at = ?
        WHERE id = ?
      `).run(title, problemStatement, summary, new Date().toISOString(), ideaId);

      if (res.changes === 0) {
        return reply.status(404).send({ error: 'Idea not found' });
      }

      await auditService.log({
        eventType: 'idea:update',
        actorType: 'human',
        actorId: 'operator',
        targetType: 'idea',
        targetId: ideaId,
        payload: { title }
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const topic = body.topic || 'privacy-first developer tools';

      const discovery = new VentureDiscoveryService();
      const ideas = await discovery.discoverIdeas(topic);

      for (const idea of ideas) {
        db.prepare(`
          INSERT INTO organization_ideas (
            id, title, problem_statement, summary, source_signals, strategic_score, feasibility_score, novelty_score, overall_score, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          idea.id,
          idea.title,
          idea.problemStatement,
          idea.summary,
          JSON.stringify(idea.sourceSignals),
          idea.strategicScore,
          idea.feasibilityScore,
          idea.noveltyScore,
          idea.overallScore,
          idea.status,
          idea.createdAt,
          idea.updatedAt
        );

        await auditService.log({
          eventType: 'idea:discover',
          actorType: 'system',
          actorId: 'discovery-engine',
          targetType: 'idea',
          targetId: idea.id,
          payload: { title: idea.title }
        });
      }

      return { success: true, ideas };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- REVIEWS & DECISIONS ---
  app.post('/ideas/:ideaId/review', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const body = request.body as { humanFeedback?: string } || {};
      
      // Persist feedback to database first
      db.prepare("UPDATE organization_ideas SET human_feedback = ?, updated_at = ? WHERE id = ?")
        .run(body.humanFeedback || null, new Date().toISOString(), ideaId);

      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        return reply.status(404).send({ error: 'Idea not found' });
      }

      const idea: any = {
        id: ideaRow.id,
        title: ideaRow.title,
        problemStatement: ideaRow.problem_statement,
        summary: ideaRow.summary,
        sourceSignals: JSON.parse(ideaRow.source_signals || '[]'),
        strategicScore: ideaRow.strategic_score,
        feasibilityScore: ideaRow.feasibility_score,
        noveltyScore: ideaRow.novelty_score,
        overallScore: ideaRow.overall_score,
        status: ideaRow.status,
        createdAt: ideaRow.created_at,
        updatedAt: ideaRow.updated_at
      };

      const roles = await registry.listRoles();
      const activeRoles = roles.filter(r => r.status === 'active');

      const { CouncilOrchestrator } = await import('../../services/organization/CouncilOrchestrator');
      const orchestrator = new CouncilOrchestrator(policyService);
      const debateResult = await orchestrator.reviewIdea('idea-review', idea, activeRoles, body.humanFeedback);

      db.prepare("UPDATE organization_ideas SET status = ?, analysis_synthesis = ?, updated_at = ? WHERE id = ?")
        .run(debateResult.consensus ? 'approved' : 'rejected', debateResult.synthesis, new Date().toISOString(), ideaId);

      if (debateResult.consensus) {
        try {
          const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
          await VentureOrchestrator.onIdeaApproved(ideaId);
        } catch (orr: any) {
          console.error(`Auto-orchestration failed on review approval: ${orr.message}`);
        }
      }

      const { DecisionMemoryService } = await import('../../services/organization/DecisionMemoryService');
      const decisionMemory = new DecisionMemoryService();
      await decisionMemory.saveDecision({
        type: 'idea-review',
        payload: { ideaId, synthesis: debateResult.synthesis, consensus: debateResult.consensus }
      });

      await auditService.log({
        eventType: 'idea:review',
        actorType: 'system',
        actorId: 'council-orchestrator',
        targetType: 'idea',
        targetId: ideaId,
        payload: { consensus: debateResult.consensus, synthesis: debateResult.synthesis, humanFeedback: body.humanFeedback }
      });

      return { 
        success: true, 
        consensus: debateResult.consensus, 
        synthesis: debateResult.synthesis, 
        humanFeedback: body.humanFeedback || null 
      };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/:ideaId/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      db.prepare("UPDATE organization_ideas SET status = 'approved', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), ideaId);

      await auditService.log({
        eventType: 'idea:approve',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: {}
      });

      try {
        const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
        await VentureOrchestrator.onIdeaApproved(ideaId);
      } catch (orr: any) {
        console.error(`Auto-orchestration failed on manual approval: ${orr.message}`);
      }

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.delete('/ideas/:ideaId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const row = db.prepare('SELECT id FROM organization_ideas WHERE id = ?').get(ideaId);
      if (!row) {
        return reply.status(404).send({ error: 'Idea not found' });
      }
      db.prepare('DELETE FROM organization_ideas WHERE id = ?').run(ideaId);

      await auditService.log({
        eventType: 'idea:delete',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: {}
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/:ideaId/generate-directives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        return reply.status(404).send({ error: 'Idea not found' });
      }

      let synthesis = ideaRow.analysis_synthesis || '';
      if (!synthesis) {
        const log = db.prepare(`
          SELECT payload FROM organization_audit_log 
          WHERE event_type = 'idea:review' AND target_id = ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(ideaId) as any;
        if (log && log.payload) {
          try {
            const payload = JSON.parse(log.payload);
            synthesis = payload.synthesis || '';
          } catch {}
        }
      }

      if (!synthesis) {
        return reply.status(400).send({ error: 'No debate summary found for this idea' });
      }

      const { InferenceRouter } = await import('../../services/InferenceRouter');

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
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.slice(7);
      }
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.slice(3);
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.slice(0, -3);
      }
      cleanJson = cleanJson.trim();

      const items = JSON.parse(cleanJson);
      const createdDirectives = [];

      for (const item of items) {
        const directive = await directiveService.createDirective({
          title: item.title,
          description: item.description,
          goalType: item.goalType || 'research',
          constraints: item.constraints || {},
          priority: Number(item.priority) || 50,
          createdBy: `system:council-debate:${ideaId}`,
        });
        createdDirectives.push(directive);

        await auditService.log({
          eventType: 'directive:create',
          actorType: 'system',
          actorId: `council-debate:${ideaId}`,
          targetType: 'directive',
          targetId: directive.id,
          payload: { title: directive.title, derivedFromIdeaId: ideaId }
        });
      }

      await auditService.log({
        eventType: 'idea:generate-directives',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: { count: createdDirectives.length }
      });

      return { success: true, directives: createdDirectives };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/:ideaId/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
      await VentureOrchestrator.onIdeaApproved(ideaId);
      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- REPOSITORIES ---
  app.get('/repositories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const repos = db.prepare('SELECT * FROM organization_repositories ORDER BY created_at DESC').all() as any[];
      const { isSessionActive } = await import('../../services/OpenClawBridge');
      const enriched = repos.map(repo => ({
        ...repo,
        isEvolving: isSessionActive(`develop-${repo.repo_name}`)
      }));
      return { success: true, repositories: enriched };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/repositories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { GiteaOrganizationService } = await import('../../services/organization/GiteaOrganizationService');
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

      const { CiCdBootstrapService } = await import('../../services/organization/CiCdBootstrapService');
      const bootstrap = new CiCdBootstrapService();
      const templateContent = bootstrap.generateWorkflow(repo.bootstrap_template as any);

      const { GiteaOrganizationService } = await import('../../services/organization/GiteaOrganizationService');
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

  app.post('/repositories/:repoId/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { repoId } = request.params as { repoId: string };
      const repo = db.prepare('SELECT * FROM organization_repositories WHERE id = ?').get(repoId) as any;
      if (!repo) {
        return reply.status(404).send({ error: 'Repository not found' });
      }

      const { KasmValidationService } = await import('../../services/organization/KasmValidationService');
      const validationService = new KasmValidationService();
      
      const validationResult = await validationService.runValidation(repo.gitea_url, 'smoke');

      db.prepare('UPDATE organization_repositories SET validation_status = ? WHERE id = ?')
        .run(validationResult.status, repoId);

      await auditService.log({
        eventType: 'repo:validate',
        actorType: 'system',
        actorId: 'kasm-validation',
        targetType: 'repository',
        targetId: repoId,
        payload: { status: validationResult.status, summary: validationResult.summary }
      });

      return { success: true, result: validationResult };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- RECRUITMENT ---
  app.get('/hr/proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const proposals = db.prepare('SELECT * FROM organization_role_proposals ORDER BY created_at DESC').all();
      return { success: true, proposals };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/hr/recruitment/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { HRRecruitmentService } = await import('../../services/organization/HRRecruitmentService');
      const hr = new HRRecruitmentService();
      
      const proposal = await hr.analyzeAndProposeRole();

      db.prepare(`
        INSERT INTO organization_role_proposals (
          id, candidate_role_name, business_need, suggested_mission, suggested_prompt, required_permissions, confidence, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        proposal.id,
        proposal.candidateRoleName,
        proposal.businessNeed,
        proposal.suggestedMission,
        proposal.suggestedPrompt,
        JSON.stringify(proposal.requiredPermissions),
        proposal.confidence,
        proposal.status,
        proposal.createdAt,
        proposal.updatedAt
      );

      await auditService.log({
        eventType: 'hr:analyze',
        actorType: 'system',
        actorId: 'hr-recruitment-service',
        targetType: 'role_proposal',
        targetId: proposal.id,
        payload: { name: proposal.candidateRoleName }
      });

      return { success: true, proposal };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/hr/proposals/:proposalId/materialize', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const proposal = db.prepare('SELECT * FROM organization_role_proposals WHERE id = ?').get(proposalId) as any;
      if (!proposal) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      // Check if a role with the same name already exists to prevent SQLite UNIQUE constraint failure
      const existingRole = db.prepare('SELECT id FROM organization_roles WHERE name = ? AND status != ?').get(proposal.candidate_role_name, 'archived');
      if (existingRole) {
        return reply.status(400).send({ error: `A role with the name "${proposal.candidate_role_name}" already exists and is active.` });
      }

      const role = await lifecycle.createRole({
        name: proposal.candidate_role_name,
        description: proposal.business_need,
        mission: proposal.suggested_mission,
        systemPrompt: proposal.suggested_prompt,
        providerPreferences: {},
        toolPermissions: JSON.parse(proposal.required_permissions || '[]'),
        memoryNamespace: `role:${proposal.candidate_role_name.toLowerCase().replace(/\s+/g, '-')}`,
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: 'system:hr'
      });

      db.prepare("UPDATE organization_role_proposals SET status = 'materialized', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), proposalId);

      const { DecisionMemoryService } = await import('../../services/organization/DecisionMemoryService');
      const decisionMemory = new DecisionMemoryService();
      await decisionMemory.linkRoleProposalMaterialized(proposalId, role.id);

      await auditService.log({
        eventType: 'role:materialize',
        actorType: 'system',
        actorId: 'hr-recruitment-service',
        targetType: 'role',
        targetId: role.id,
        payload: { proposalId }
      });

      return { success: true, role };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.put('/hr/proposals/:proposalId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const body = request.body as any;
      const { candidateRoleName, businessNeed, suggestedMission, suggestedPrompt, requiredPermissions } = body;

      const res = db.prepare(`
        UPDATE organization_role_proposals
        SET candidate_role_name = ?, business_need = ?, suggested_mission = ?, suggested_prompt = ?, required_permissions = ?, updated_at = ?
        WHERE id = ?
      `).run(
        candidateRoleName,
        businessNeed,
        suggestedMission,
        suggestedPrompt,
        JSON.stringify(requiredPermissions || []),
        new Date().toISOString(),
        proposalId
      );

      if (res.changes === 0) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      await auditService.log({
        eventType: 'hr_proposal:update',
        actorType: 'human',
        actorId: 'human',
        targetType: 'role_proposal',
        targetId: proposalId,
        payload: { name: candidateRoleName }
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.delete('/hr/proposals/:proposalId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { proposalId } = request.params as { proposalId: string };
      const row = db.prepare('SELECT id FROM organization_role_proposals WHERE id = ?').get(proposalId);
      if (!row) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }
      db.prepare('DELETE FROM organization_role_proposals WHERE id = ?').run(proposalId);

      await auditService.log({
        eventType: 'hr_proposal:delete',
        actorType: 'human',
        actorId: 'human',
        targetType: 'role_proposal',
        targetId: proposalId,
        payload: {}
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- AUTONOMOUS DISCOVERY ---
  app.get('/autonomous-discovery/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return { success: true, status: AutonomousVentureEngine.getStatus() };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.patch('/autonomous-discovery/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const patch = request.body as any;
      const updated = AutonomousVentureEngine.updateConfig(patch);
      return { success: true, config: updated };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/autonomous-discovery/trigger', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await AutonomousVentureEngine.runCycle(true);
      return { success: true, ...result };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // ─── GITEA CI/CD WEBHOOK ──────────────────────────────────────────────────
  // Receives workflow_run / check_run events from Gitea and updates repo status.
  app.post('/webhooks/gitea', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = request.body as any;
      const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
      VentureOrchestrator.handleCiWebhook(payload);
      return reply.status(200).send({ ok: true });
    } catch (e: any) {
      // Always return 200 to prevent Gitea from disabling the webhook
      return reply.status(200).send({ ok: false, error: e.message });
    }
  });

  // ─── STALE SESSION WATCHDOG ───────────────────────────────────────────────
  // Run once at startup (after a short delay to allow WS connection) and
  // then every 30 minutes to auto-heal repos stuck in "evolving" state.
  setTimeout(async () => {
    try {
      const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
      await VentureOrchestrator.runWatchdog();
    } catch (e: any) {
      console.error('[VentureWatchdog] Startup run failed:', e.message);
    }
  }, 30_000); // 30s delay to let WebSocket connect first

  setInterval(async () => {
    try {
      const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
      await VentureOrchestrator.runWatchdog();
    } catch (e: any) {
      console.error('[VentureWatchdog] Periodic run failed:', e.message);
    }
  }, 30 * 60_000); // every 30 minutes
}


