import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { directiveService, auditService } from './shared';
import { DirectiveService } from '../../../services/organization/DirectiveService';
import db from '../../../db/sqlite';

/** Strategic directives and the organization audit log. */
export async function organizationDirectivesRoutes(app: FastifyInstance) {
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
}
