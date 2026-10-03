import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import WebSocket from 'ws';

const router = vi.hoisted(() => ({
  nodeSockets: new Map<string, unknown>(),
  pendingMobileTasks: new Map<string, { node: string; callback: (r: unknown) => void; cleanup: () => void }>(),
  updates: [] as unknown[],
}));

vi.mock('../src/services/InferenceRouter', () => ({
  InferenceRouter: {
    nodeSockets: router.nodeSockets,
    pendingMobileTasks: router.pendingMobileTasks,
    onTaskUpdate: (id: string, update: unknown) => router.updates.push([id, update]),
    handleNodeDisconnection: vi.fn(),
  },
}));
vi.mock('../src/services/NodeRegistry', () => ({
  NodeRegistry: { registerNode: vi.fn(), heartbeat: vi.fn(), updateStatus: vi.fn() },
}));

import nodesWs from '../src/api/websocket/nodes.ws';

describe('/ws/nodes task ownership', () => {
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(websocketPlugin);
    await app.register(nodesWs);
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `ws://127.0.0.1:${(app.server.address() as any).port}`;
  });

  afterAll(async () => { await app.close(); });

  it('accepts results only from the node the task was assigned to', async () => {
    const results: string[] = [];
    router.pendingMobileTasks.set('task-of-n2', { node: 'N2', callback: () => results.push('task-of-n2'), cleanup: vi.fn() });
    router.pendingMobileTasks.set('task-of-n1', { node: 'n1', callback: () => results.push('task-of-n1'), cleanup: vi.fn() });

    const ws = new WebSocket(`${base}/ws/nodes?id=n1&name=Phone`);
    await new Promise(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'result', id: 'task-of-n2', reply: 'forged' }));
    ws.send(JSON.stringify({ type: 'token', id: 'task-of-n2', token: 'forged' }));
    ws.send(JSON.stringify({ type: 'result', id: 'task-of-n1', reply: 'legit' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    ws.close();

    expect(results).toEqual(['task-of-n1']);
    expect(router.updates.some(u => (u as unknown[])[0] === 'task-of-n2')).toBe(false);
  });
});
