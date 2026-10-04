import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditService } from './shared';
import { AutonomousVentureEngine } from '../../../services/organization/AutonomousVentureEngine';
import { getBuildSettings, updateBuildSettings } from '../../../services/organization/venture/BuildSettings';

/** Autonomous discovery schedule and the venture build settings (kill switch). */
export async function organizationDiscoveryRoutes(app: FastifyInstance) {
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

  // Venture build loop settings; `enabled` is the kill switch of every development agent run
  app.get('/build-config', async () => ({ success: true, config: getBuildSettings() }));

  app.patch('/build-config', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'JSON object expected' });
    }
    const config = updateBuildSettings(body as Record<string, unknown>);
    await auditService.log({
      eventType: 'build-config:update',
      actorType: 'human',
      actorId: 'human',
      targetType: 'organization',
      targetId: 'build-config',
      payload: { ...config },
    });
    return { success: true, config };
  });

  app.post('/autonomous-discovery/trigger', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await AutonomousVentureEngine.runCycle(true);
      return { success: true, ...result };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });
}
