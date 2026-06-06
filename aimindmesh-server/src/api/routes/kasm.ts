import { FastifyInstance } from 'fastify';
import { KasmService } from '../../services/KasmService';
import { config } from '../../config';

export default async function kasmRoutes(fastify: FastifyInstance) {
  // Middleware to check if Kasm is enabled
  fastify.addHook('preHandler', async (request, reply) => {
    if (!config.kasm?.enabled) {
      reply.status(403).send({ error: 'Kasm integration is disabled' });
    }
  });

  fastify.get('/status', async () => {
    const sessions = await KasmService.listSessions();
    return {
      enabled: config.kasm?.enabled,
      baseUrl: config.kasm?.baseUrl,
      activeSessions: sessions.length,
      sessions,
    };
  });

  fastify.get('/images', async () => {
    return await KasmService.getImages();
  });

  fastify.post('/sessions', async (request: any) => {
    const { imageId } = request.body || {};
    return await KasmService.requestSession(imageId);
  });

  fastify.post('/exec', async (request: any) => {
    const { kasmId, cmd } = request.body || {};
    if (!kasmId || !cmd) {
      throw new Error('kasmId and cmd are required');
    }
    return await KasmService.executeCommand(kasmId, cmd);
  });

  fastify.get('/sessions/:id/screenshot', async (request: any) => {
    const { id } = request.params;
    const screenshot = await KasmService.getScreenshot(id);
    return { screenshot };
  });

  fastify.delete('/sessions/:id', async (request: any) => {
    const { id } = request.params;
    await KasmService.destroySession(id);
    return { success: true };
  });
}
