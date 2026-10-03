import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import WebSocket from 'ws';

const mocks = vi.hoisted(() => ({ routeTask: vi.fn(), registerClient: vi.fn() }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { routeTask: mocks.routeTask } }));
vi.mock('../src/services/NotificationService', () => ({
  NotificationService: { registerClient: mocks.registerClient, unregisterClient: vi.fn() },
}));
vi.mock('../src/services/AutoEvolutionPipeline', () => ({ autoEvolutionPipeline: { injectUserRequest: vi.fn() } }));

import db from '../src/db/sqlite';
import chatWs from '../src/api/websocket/chat.ws';

let app: FastifyInstance;
let base: string;

/** Sends one completion and collects the replies until done/error. */
async function complete(request: object): Promise<any[]> {
  const ws = new WebSocket(`${base}/ws/chat?mode=completion`);
  const replies: any[] = [];
  await new Promise(resolve => ws.on('open', resolve));
  const finished = new Promise<void>(resolve => ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    replies.push(msg);
    if (msg.type === 'done' || msg.type === 'error') resolve();
  }));
  ws.send(JSON.stringify(request));
  await finished;
  ws.close();
  return replies;
}

beforeAll(async () => {
  app = Fastify();
  await app.register(websocketPlugin);
  await app.register(chatWs);
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `ws://127.0.0.1:${(app.server.address() as any).port}`;
});
afterAll(async () => { await app.close(); });
beforeEach(() => { db.exec(`DELETE FROM direct_chats; DELETE FROM conversations;`); });

describe('/ws/chat?mode=completion (mobile streaming)', () => {
  it('streams deltas and thoughts tagged with the requestId, then done', async () => {
    mocks.routeTask.mockImplementation(async (_payload: any, onUpdate: (u: any) => void) => {
      onUpdate({ type: 'thinking', content: 'hmm' });
      onUpdate({ type: 'token', content: 'Hel' });
      onUpdate({ type: 'token', content: 'lo' });
      return { provider: 'SERVER_LOCAL', response: 'Hello' };
    });

    const replies = await complete({ type: 'completion', requestId: 'r1', messages: [{ role: 'user', content: 'hi' }], options: { routing: 'gemini' } });

    expect(replies).toEqual([
      { type: 'ack', requestId: 'r1' },
      { type: 'thought', requestId: 'r1', content: 'hmm' },
      { type: 'delta', requestId: 'r1', content: 'Hel' },
      { type: 'delta', requestId: 'r1', content: 'lo' },
      { type: 'done', requestId: 'r1', usedNode: 'SERVER_LOCAL' },
    ]);
    expect(mocks.routeTask.mock.calls[0][0]).toMatchObject({ type: 'GENERAL_CHAT', prompt: 'user: hi', options: { routing: 'gemini' } });
  });

  it('sends the whole answer once when the provider does not stream text', async () => {
    mocks.routeTask.mockImplementation(async (_p: any, onUpdate: (u: any) => void) => {
      onUpdate({ type: 'thinking', content: 'only thoughts' });
      return { provider: 'GEMINI_API', response: 'Full answer' };
    });
    const replies = await complete({ type: 'completion', requestId: 'r2', messages: [{ role: 'user', content: 'q' }] });
    expect(replies.filter(r => r.type === 'delta')).toEqual([{ type: 'delta', requestId: 'r2', content: 'Full answer' }]);
  });

  it('reports errors with the requestId', async () => {
    mocks.routeTask.mockRejectedValue(new Error('NODE_X_UNAVAILABLE'));
    expect(await complete({ type: 'completion', requestId: 'r3', messages: [{ role: 'user', content: 'q' }] }))
      .toEqual([{ type: 'ack', requestId: 'r3' }, { type: 'error', requestId: 'r3', message: 'NODE_X_UNAVAILABLE' }]);
  });

  it('is stateless: no history sent, nothing stored, no notification client', async () => {
    mocks.routeTask.mockResolvedValue({ provider: 'P', response: 'ok' });
    const replies = await complete({ type: 'completion', requestId: 'r4', messages: [{ role: 'user', content: 'q' }] });

    expect(replies.map(r => r.type)).toEqual(['ack', 'delta', 'done']);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM conversations`).get()).toEqual({ c: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM direct_chats`).get()).toEqual({ c: 0 });
    expect(mocks.registerClient).not.toHaveBeenCalled();
  });
});
