import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { lifecycle, auditService } from './shared';
import db from '../../../db/sqlite';

/** HR recruitment: role proposals and their materialization. */
export async function organizationHrRoutes(app: FastifyInstance) {
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
      const { HRRecruitmentService } = await import('../../../services/organization/HRRecruitmentService');
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
}
