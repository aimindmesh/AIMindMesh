import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registry, lifecycle, auditService } from './shared';

/** Roles of the AI organization (CRUD, archive). */
export async function organizationRolesRoutes(app: FastifyInstance) {
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
}
