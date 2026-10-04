import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

const mocks = vi.hoisted(() => ({
  sendToDevice: vi.fn(async () => {}),
  upsertMemory: vi.fn(async () => 'neo-1'),
  deleteMemoryBySyncId: vi.fn(async () => true),
}));

vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: mocks.sendToDevice }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { getEmbeddings: vi.fn(async () => [0.1]), routeTask: vi.fn(), setBrake: vi.fn() } }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));
vi.mock('../src/services/KGManager', () => ({ KGManager: { upsertMemory: mocks.upsertMemory } }));
vi.mock('../src/services/KGMemories', () => ({ deleteMemoryBySyncId: mocks.deleteMemoryBySyncId }));

import db from '../src/db/sqlite';
import { DeliveryScheduler } from '../src/services/DeliveryScheduler';
import { DebateEngine } from '../src/services/DebateEngine';
import { MIGRATIONS, runMigrations } from '../src/db/migrations';
import { hourIn, isWithinQuietHours, toHHMM } from '../src/utils/quietHours';
import deliveryRoutes from '../src/api/routes/delivery';
import kgRoutes from '../src/api/routes/kg';

/** 23:30 in Rome (summer, UTC+2) and 08:00 in Rome */
const ROME_NIGHT = new Date(Date.UTC(2026, 6, 1, 21, 30));
const ROME_MORNING = new Date(Date.UTC(2026, 6, 1, 6, 0));

function phone(id: string, token: string) {
  db.prepare(`INSERT INTO nodes (id, name, type, fcm_token) VALUES (?, ?, 'mobile', ?)`).run(id, id, token);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(deliveryRoutes, { prefix: '/api/delivery' });
  app.register(kgRoutes, { prefix: '/api/kg' });
  await app.ready();
});
afterAll(() => app.close());

beforeEach(() => {
  db.exec(`DELETE FROM pending_delivery; DELETE FROM feed_items; DELETE FROM node_settings; DELETE FROM nodes;`);
  mocks.sendToDevice.mockClear();
});

describe('quiet hours helpers', () => {
  it('read the hour in the device time zone, not the container one', () => {
    expect(hourIn(ROME_NIGHT, 'Europe/Rome')).toBe(23.5);
    expect(hourIn(ROME_MORNING, 'Europe/Rome')).toBe(8);
    expect(isWithinQuietHours(23.5, '22:00', '07:00')).toBe(true);
    expect(isWithinQuietHours(8, '22:00', '07:00')).toBe(false);
    expect(toHHMM(22)).toBe('22:00');
    expect(toHHMM('7:30')).toBe('07:30');
    expect(toHHMM('25')).toBeNull();
  });
});

describe('delivery settings and pending items (phones send lower-case ids)', () => {
  it('stores the settings under the node id and serves the items queued for it', async () => {
    phone('2A1B9AB4DDC449E5', 'tok');
    const res = await app.inject({
      method: 'PUT', url: '/api/delivery/settings', headers: { 'x-device-id': '2a1b9ab4ddc449e5' },
      payload: { deliveryMode: 'CONTEXTUAL', quietHours: { enabled: true, start: 22, end: 7 }, timezone: 'Europe/Rome' },
    });
    expect(res.statusCode).toBe(200);
    expect(DeliveryScheduler.getDeviceSettings('2A1B9AB4DDC449E5')).toEqual({
      mode: 'CONTEXTUAL', quietHours: { enabled: true, start: '22:00', end: '07:00' }, timezone: 'Europe/Rome',
    });

    // A partial update keeps the other fields
    await app.inject({ method: 'PUT', url: '/api/delivery/settings', headers: { 'x-device-id': '2a1b9ab4ddc449e5' }, payload: { deliveryMode: 'PUSH' } });
    expect(DeliveryScheduler.getDeviceSettings('2a1b9ab4ddc449e5')).toMatchObject({ mode: 'PUSH', timezone: 'Europe/Rome' });

    await app.inject({ method: 'PUT', url: '/api/delivery/settings', headers: { 'x-device-id': '2a1b9ab4ddc449e5' }, payload: { deliveryMode: 'CONTEXTUAL' } });
    await DeliveryScheduler.deliver('ins-1', 'Idea', 'An idea', 'INSIGHT');
    expect(mocks.sendToDevice).not.toHaveBeenCalled();
    const pending = await app.inject({ method: 'GET', url: '/api/delivery/pending', headers: { 'x-device-id': '2a1b9ab4ddc449e5' } });
    expect(pending.json()).toMatchObject({ count: 1, items: [{ insightId: 'ins-1' }] });
  });

  it('rejects invalid settings', async () => {
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/delivery/settings', headers: { 'x-device-id': 'abc' }, payload: payload as any });
    expect((await put({ timezone: 'Mars/Olympus' })).statusCode).toBe(400);
    expect((await put({ quietHours: { enabled: true, start: 'late', end: 7 } })).statusCode).toBe(400);
    expect((await put({ deliveryMode: 'LOUD' })).statusCode).toBe(400);
    expect((await put({})).statusCode).toBe(400);
  });

  it('holds pushes back in each device\'s own quiet hours', async () => {
    phone('NIGHT', 'tok-night');
    phone('DAY', 'tok-day');
    DeliveryScheduler.updateDeviceSettings('night', { quietHours: { enabled: true, start: '22:00', end: '07:00' }, timezone: 'Europe/Rome' });
    DeliveryScheduler.updateDeviceSettings('day', { quietHours: { enabled: false, start: '22:00', end: '07:00' }, timezone: 'Europe/Rome' });
    expect(DeliveryScheduler.isQuietHour('NIGHT', ROME_NIGHT)).toBe(true);
    expect(DeliveryScheduler.isQuietHour('NIGHT', ROME_MORNING)).toBe(false);

    vi.useFakeTimers({ now: ROME_NIGHT, toFake: ['Date'] });
    try {
      await DeliveryScheduler.deliver('ins-2', 'Idea', 'An idea', 'INSIGHT');
    } finally {
      vi.useRealTimers();
    }
    expect(mocks.sendToDevice).toHaveBeenCalledTimes(1);
    expect(mocks.sendToDevice).toHaveBeenCalledWith('tok-day', expect.objectContaining({ data: expect.objectContaining({ type: 'INSIGHT_DELIVERY' }) }));
    expect(DeliveryScheduler.getPendingForDevice('night')).toHaveLength(1);
  });

  it('sends debate rounds only to devices that take pushes now', () => {
    phone('PUSHER', 'tok-push');
    phone('QUIET', 'tok-quiet');
    phone('CONTEXT', 'tok-context');
    DeliveryScheduler.updateDeviceSettings('QUIET', { quietHours: { enabled: true, start: '00:00', end: '23:59' } });
    DeliveryScheduler.updateDeviceSettings('CONTEXT', { mode: 'CONTEXTUAL' });
    (DebateEngine as any).pushDebateUpdate('ins-3', 2, 'The critic replied');
    expect(mocks.sendToDevice.mock.calls.map(c => (c as unknown[])[0])).toEqual(['tok-push']);
  });
});

describe('migration v5', () => {
  it('moves settings written under lower-case ids to the node id', () => {
    const old = new Database(':memory:');
    runMigrations(old, MIGRATIONS.filter(m => m.version <= 4));
    old.prepare(`INSERT INTO node_settings (node_id, delivery_mode) VALUES ('abc', 'CONTEXTUAL')`).run();
    runMigrations(old);
    expect(old.prepare(`SELECT * FROM node_settings`).all()).toEqual([
      { node_id: 'ABC', delivery_mode: 'CONTEXTUAL', quiet_enabled: null, quiet_start: null, quiet_end: null, timezone: null },
    ]);
  });
});

describe('phone facts in the knowledge graph', () => {
  it('updates the same memory on every sync and deletes it when the user forgets it', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/kg/memories',
      payload: { id: 'f-1', content: 'Works as a nurse', category: 'identity', source: 'aimindmesh_android', createdAt: '2026-09-01T10:00:00.000Z' },
    });
    expect(post.statusCode).toBe(200);
    expect(mocks.upsertMemory).toHaveBeenCalledWith('Works as a nurse', [0.1], 'identity', 'aimindmesh_android', 'fact:f-1', Date.parse('2026-09-01T10:00:00.000Z'));

    const del = await app.inject({ method: 'DELETE', url: '/api/kg/memories/f-1' });
    expect(del.json()).toEqual({ ok: true, deleted: true });
    expect(mocks.deleteMemoryBySyncId).toHaveBeenCalledWith('fact:f-1');
    expect((await app.inject({ method: 'POST', url: '/api/kg/memories', payload: { content: '' } })).statusCode).toBe(400);
  });
});
