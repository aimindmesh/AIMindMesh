import crypto from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../src/config';
import db from '../src/db/sqlite';

const spies = vi.hoisted(() => ({ ingestGiteaComment: vi.fn(), handleCiWebhook: vi.fn() }));
vi.mock('../src/services/FeedbackService', () => ({ feedbackService: { ingestGiteaComment: spies.ingestGiteaComment } }));
vi.mock('../src/services/organization/VentureOrchestrator', () => ({ VentureOrchestrator: { handleCiWebhook: spies.handleCiWebhook } }));

import giteaWebhookRoutes, { giteaCiWebhookRoutes } from '../src/api/routes/giteaWebhook';
import { registerLenientJsonParser } from '../src/utils/lenientJsonParser';

const sign = (body: string, secret = 'whsec-test') => crypto.createHmac('sha256', secret).update(body).digest('hex');

describe('Gitea webhooks (HMAC)', () => {
  let app: FastifyInstance;
  const comment = JSON.stringify({ action: 'created', issue: { number: 7, pull_request: {} }, comment: { body: 'please fix', user: { login: 'andrea' } } });

  beforeAll(async () => {
    db.prepare(`INSERT INTO evolution_candidates (id, source, source_id, title, description, target_component, created_at)
                VALUES ('c1', 'manual', 's', 't', 'd', 'x', 0)`).run();
    db.prepare(`INSERT INTO evolution_proposals (id, candidate_id, title, explanation, branch_name, pr_url, pr_number, target_component, created_at)
                VALUES ('p1', 'c1', 't', 'e', 'b', 'u', 7, 'x', 0)`).run();
    app = Fastify();
    registerLenientJsonParser(app);
    app.register(giteaWebhookRoutes, { prefix: '/api/evolution' });
    app.register(giteaCiWebhookRoutes, { prefix: '/api/organization' });
    app.post('/api/other', async req => ({ echoed: req.body }));
    await app.ready();
  });

  beforeEach(() => {
    (config.autoEvolution as any).giteaWebhookSecret = 'whsec-test';
  });

  const post = (url: string, payload: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', 'x-gitea-event': 'issue_comment', ...headers } });

  it('rejects everything when no secret is configured', async () => {
    (config.autoEvolution as any).giteaWebhookSecret = '';
    expect((await post('/api/evolution/gitea/webhook', comment, { 'x-gitea-signature': sign(comment) })).statusCode).toBe(401);
  });

  it('rejects missing or wrong signatures', async () => {
    expect((await post('/api/evolution/gitea/webhook', comment)).statusCode).toBe(401);
    expect((await post('/api/evolution/gitea/webhook', comment, { 'x-gitea-signature': 'deadbeef' })).statusCode).toBe(401);
    expect(spies.ingestGiteaComment).not.toHaveBeenCalled();
  });

  it('ingests PR comments with a valid signature', async () => {
    const res = await post('/api/evolution/gitea/webhook', comment, { 'x-gitea-signature': sign(comment) });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(spies.ingestGiteaComment).toHaveBeenCalledWith('p1', 'please fix', 'andrea'));
  });

  it('protects the organization CI webhook the same way', async () => {
    const ci = JSON.stringify({ action: 'completed', workflow_run: { conclusion: 'success' } });
    expect((await post('/api/organization/webhooks/gitea', ci)).statusCode).toBe(401);
    expect(spies.handleCiWebhook).not.toHaveBeenCalled();
    const ok = await post('/api/organization/webhooks/gitea', ci, { 'x-gitea-signature': sign(ci) });
    expect(ok.statusCode).toBe(200);
    expect(spies.handleCiWebhook).toHaveBeenCalledWith(JSON.parse(ci));
  });

  it('keeps the normal JSON parser for other routes', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/other', payload: { a: 1 } });
    expect(res.json()).toEqual({ echoed: { a: 1 } });
  });
});
