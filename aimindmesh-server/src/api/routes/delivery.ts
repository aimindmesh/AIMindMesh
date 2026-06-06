import { FastifyInstance } from 'fastify';
import { DeliveryScheduler, DeliveryMode } from '../../services/DeliveryScheduler';

export default async function (fastify: FastifyInstance) {
  /**
   * GET /api/delivery/pending
   * The device calls this endpoint when it detects high availability.
   * Returns queued insights + marks them as delivered.
   */
  fastify.get('/pending', async (request, reply) => {
    const deviceId = request.headers['x-device-id'] as string;
    if (!deviceId) {
      reply.status(400).send({ error: 'X-Device-Id header required' });
      return;
    }

    const items = DeliveryScheduler.getPendingForDevice(deviceId);
    const ids = items.map(i => i.id);

    // Mark as delivered immediately
    DeliveryScheduler.markDelivered(ids);

    return { items, count: items.length };
  });

  /**
   * PUT /api/delivery/settings
   * The device sends its delivery mode preference.
   *
   * Body: { deliveryMode: 'PUSH' | 'CONTEXTUAL' }
   */
  fastify.put('/settings', async (request, reply) => {
    const deviceId = request.headers['x-device-id'] as string;
    const { deliveryMode } = request.body as { deliveryMode: DeliveryMode };

    if (!deviceId || !['PUSH', 'CONTEXTUAL'].includes(deliveryMode)) {
      reply.status(400).send({ error: 'Invalid parameters or missing X-Device-Id' });
      return;
    }

    DeliveryScheduler.setModeForDevice(deviceId, deliveryMode);
    return { ok: true, deviceId, deliveryMode };
  });
}
