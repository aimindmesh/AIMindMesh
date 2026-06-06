import { FastifyInstance } from 'fastify';
import { SyncManager, SyncPayload } from '../../services/SyncManager';
import { Logger } from '../../utils/Logger';

export default async function (fastify: FastifyInstance) {
  // ── POST /api/sync/push ───────────────────────────────────────────────────
  // Receive data from a mobile device
  fastify.post('/push', async (request, reply) => {
    try {
      const payload = request.body as SyncPayload;
      const sizeKB = Math.round(JSON.stringify(payload).length / 1024);
      Logger.info('SyncRoute', `Received push from ${payload.deviceId} (Size: ${sizeKB}KB)`);
      
      if (!payload.deviceId) {
        return reply.code(400).send({ error: 'Missing deviceId' });
      }

      await SyncManager.handlePush(payload);
      return { ok: true, timestamp: Date.now() };
    } catch (e: any) {
      Logger.error('SyncRoute', `Push failed: ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });

  // ── GET /api/sync/pull ────────────────────────────────────────────────────
  // Send updates to a mobile device
  fastify.get<{ Querystring: { deviceId: string, since: string } }>('/pull', async (request, reply) => {
    try {
      const { deviceId, since } = request.query;
      if (!deviceId) {
        return reply.code(400).send({ error: 'Missing deviceId' });
      }

      const sinceTs = parseInt(since || '0', 10);
      const data = await SyncManager.handlePull(deviceId, sinceTs);
      return data;
    } catch (e: any) {
      Logger.error('SyncRoute', `Pull failed: ${e.message}`);
      return reply.code(500).send({ error: e.message });
    }
  });
}
