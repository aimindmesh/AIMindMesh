import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import WebSocket from 'ws';
import { authHook, extractApiKey, isValidApiKey, redactUrl, safeEqual } from '../src/middleware/auth';

function wsStatus(url: string): Promise<{ open: boolean; status?: number }> {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    ws.on('open', () => { ws.close(); resolve({ open: true }); });
    ws.on('unexpected-response', (_req, res) => resolve({ open: false, status: res.statusCode }));
    ws.on('error', () => resolve({ open: false }));
  });
}

describe('API key helpers', () => {
  it('accepts the global key and per-node keys only', () => {
    expect(isValidApiKey('test-global-key')).toBe(true);
    expect(isValidApiKey('test-node-key')).toBe(true);
    expect(isValidApiKey('wrong')).toBe(false);
    expect(isValidApiKey('')).toBe(false);
    expect(isValidApiKey(undefined)).toBe(false);
  });

  it('compares in constant time without length leaks', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('reads ?token= only for WebSocket paths', () => {
    expect(extractApiKey({ url: '/ws/chat?token=t', headers: {}, query: { token: 't' } } as any)).toBe('t');
    expect(extractApiKey({ url: '/api/x?token=t', headers: {}, query: { token: 't' } } as any)).toBeUndefined();
    expect(extractApiKey({ url: '/api/x', headers: { 'x-api-key': 'h' }, query: {} } as any)).toBe('h');
  });

  it('masks credentials in logged URLs', () => {
    expect(redactUrl('/ws/nodes?id=A&token=secret&name=x')).toBe('/ws/nodes?id=A&token=***&name=x');
    expect(redactUrl('/x?apiKey=k')).toBe('/x?apiKey=***');
  });
});

describe('authHook', () => {
  let app: FastifyInstance;
  let wsBase: string;
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-test-'));

  beforeAll(async () => {
    fs.writeFileSync(path.join(dlDir, 'versions.json'), '{"latest":"1.0.0"}');
    app = Fastify();
    await app.register(websocketPlugin);
    // Same order as index.ts: static first, hook afterwards (route hooks are attached at ready)
    await app.register(fastifyStatic, { root: dlDir, prefix: '/dl/', decorateReply: false });
    app.addHook('preValidation', authHook);
    app.get('/ws/echo', { websocket: true }, socket => socket.send('hello'));
    app.get('/api/ping', async () => ({ pong: true }));
    app.post('/api/freellmapi-proxy/v1/chat/completions', async () => ({ proxied: true }));
    app.post('/api/evolution/gitea/webhook', async () => ({ hook: true }));
    app.post('/api/organization/webhooks/gitea', async () => ({ ci: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    wsBase = `ws://127.0.0.1:${(app.server.address() as any).port}`;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dlDir, { recursive: true, force: true });
  });

  it('rejects WebSocket upgrades without a valid token', async () => {
    expect(await wsStatus(`${wsBase}/ws/echo`)).toEqual({ open: false, status: 401 });
    expect(await wsStatus(`${wsBase}/ws/echo?token=wrong`)).toEqual({ open: false, status: 401 });
  });

  it('accepts WebSocket upgrades with the global or a node key', async () => {
    expect((await wsStatus(`${wsBase}/ws/echo?token=test-global-key`)).open).toBe(true);
    expect((await wsStatus(`${wsBase}/ws/echo?token=test-node-key`)).open).toBe(true);
  });

  it('requires the x-api-key header for REST (no ?token=)', async () => {
    expect((await app.inject({ url: '/api/ping' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/ping?token=test-global-key' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/ping', headers: { 'x-api-key': 'test-global-key' } })).statusCode).toBe(200);
  });

  it('lets self-authenticated routes handle their own credentials', async () => {
    for (const url of ['/api/freellmapi-proxy/v1/chat/completions', '/api/evolution/gitea/webhook', '/api/organization/webhooks/gitea']) {
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(200);
    }
  });

  it('serves /dl/ installers to plain GET links', async () => {
    const res = await app.inject({ url: '/dl/versions.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ latest: '1.0.0' });
  });
});
