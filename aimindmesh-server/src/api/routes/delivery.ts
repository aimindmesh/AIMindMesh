import { FastifyInstance } from 'fastify';
import { DeliveryScheduler, DeliveryMode, DeviceDeliveryUpdate } from '../../services/DeliveryScheduler';
import { isValidTimeZone, normalizeDeviceId, toHHMM } from '../../utils/quietHours';

/** Phones send their raw ANDROID_ID (lower case): node ids are upper case */
function deviceIdOf(headers: Record<string, unknown>): string {
  return normalizeDeviceId(headers['x-device-id']);
}

export default async function (fastify: FastifyInstance) {
  /**
   * GET /api/delivery/pending
   * The device calls this endpoint when it detects high availability.
   * Returns queued insights + marks them as delivered.
   */
  fastify.get('/pending', async (request, reply) => {
    const deviceId = deviceIdOf(request.headers);
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
   * The device sends its delivery preferences; every field is optional (partial update).
   *
   * Body: { deliveryMode?: 'PUSH' | 'CONTEXTUAL',
   *         quietHours?: { enabled: boolean, start: number | "HH:MM", end: number | "HH:MM" },
   *         timezone?: IANA zone, e.g. "Europe/Rome" }
   */
  fastify.put('/settings', async (request, reply) => {
    const deviceId = deviceIdOf(request.headers);
    const body = (request.body ?? {}) as {
      deliveryMode?: DeliveryMode;
      quietHours?: { enabled?: unknown; start?: unknown; end?: unknown };
      timezone?: unknown;
    };

    const update: DeviceDeliveryUpdate = {};
    if (body.deliveryMode !== undefined) {
      if (!['PUSH', 'CONTEXTUAL'].includes(body.deliveryMode)) {
        reply.status(400).send({ error: 'deliveryMode must be PUSH or CONTEXTUAL' });
        return;
      }
      update.mode = body.deliveryMode;
    }
    if (body.quietHours !== undefined) {
      const start = toHHMM(body.quietHours?.start);
      const end = toHHMM(body.quietHours?.end);
      if (typeof body.quietHours?.enabled !== 'boolean' || !start || !end) {
        reply.status(400).send({ error: 'quietHours needs enabled (boolean), start and end (hour or "HH:MM")' });
        return;
      }
      update.quietHours = { enabled: body.quietHours.enabled, start, end };
    }
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== 'string' || !isValidTimeZone(body.timezone)) {
        reply.status(400).send({ error: 'timezone must be an IANA time zone' });
        return;
      }
      update.timezone = body.timezone;
    }

    if (!deviceId || Object.keys(update).length === 0) {
      reply.status(400).send({ error: 'Invalid parameters or missing X-Device-Id' });
      return;
    }

    DeliveryScheduler.updateDeviceSettings(deviceId, update);
    return { ok: true, deviceId, deliveryMode: DeliveryScheduler.getModeForDevice(deviceId) };
  });
}
