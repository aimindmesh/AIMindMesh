import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import Fastify, { FastifyInstance } from 'fastify';
import { config } from './fixtures/config';

const mocks = vi.hoisted(() => ({
  routeTask: vi.fn(async () => ({ response: 'hello', provider: 'GEMINI' })),
  processSpecificCandidate: vi.fn(async () => {}),
  getTask: vi.fn(),
  getExecutions: vi.fn(),
}));

vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { routeTask: mocks.routeTask } }));
vi.mock('../src/services/DebateEngine', () => ({ DebateEngine: { getThreadByInsightId: () => null } }));
vi.mock('../src/services/ProactiveEngine', () => ({ ProactiveEngine: {} }));
vi.mock('../src/services/AiTaskScheduler', () => ({ AiTaskScheduler: { getTask: mocks.getTask, getExecutions: mocks.getExecutions } }));
vi.mock('../src/services/AutoEvolutionPipeline', () => ({
  autoEvolutionPipeline: { processSpecificCandidate: mocks.processSpecificCandidate },
}));

import { resolveAiTaskRouting } from '../src/services/aiTasks/aiTaskRouting';
import { normalizeModel, normalizeRouting } from '../src/utils/routing';
import { registerLenientJsonParser } from '../src/utils/lenientJsonParser';
import { FeedManager } from '../src/services/FeedManager';
import { GiteaOrganizationService } from '../src/services/organization/GiteaOrganizationService';
import chatRoutes from '../src/api/routes/chat';
import feedRoutes from '../src/api/routes/feed';
import aiTasksRoutes from '../src/api/routes/aiTasksRouter';
import evolutionRoutes from '../src/api/routes/evolution';

describe('AI task routing (provider vs model)', () => {
  it('reads legacy rows that stored the provider name in model', () => {
    expect(resolveAiTaskRouting({ provider: 'auto', model: 'gemini' })).toEqual({ taskType: 'SCHEDULED_TASK', provider: 'gemini', routing: 'GEMINI', model: undefined });
    expect(resolveAiTaskRouting({ provider: 'auto', model: 'ollama' }).routing).toBe('SERVER_LOCAL');
    expect(resolveAiTaskRouting({ provider: 'auto', model: 'openclaw' })).toMatchObject({ taskType: 'AGENTIC_TASK', routing: 'OPENCLAW' });
  });

  it('never passes a provider keyword as a model id', () => {
    expect(resolveAiTaskRouting({ provider: 'gemini', model: 'gemini' }).model).toBeUndefined();
    expect(resolveAiTaskRouting({ provider: 'auto', model: 'auto' })).toEqual({ taskType: 'SCHEDULED_TASK', provider: 'auto', routing: undefined, model: undefined });
  });

  it('keeps explicit model ids', () => {
    expect(resolveAiTaskRouting({ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }))
      .toMatchObject({ routing: 'OPENROUTER', model: 'anthropic/claude-3.5-sonnet' });
  });
});

describe('routing / model validation', () => {
  it('accepts node ids and provider names, AUTO means automatic', () => {
    expect(normalizeRouting('GEMINI')).toBe('GEMINI');
    expect(normalizeRouting('node_01-a')).toBe('node_01-a');
    expect(normalizeRouting('auto')).toBeUndefined();
    expect(normalizeRouting('../x')).toBeUndefined();
    expect(normalizeRouting(42)).toBeUndefined();
  });

  it('accepts model ids, rejects anything else', () => {
    expect(normalizeModel('anthropic/claude-3.5-sonnet')).toBe('anthropic/claude-3.5-sonnet');
    expect(normalizeModel('llama3:8b')).toBe('llama3:8b');
    expect(normalizeModel('a b')).toBeUndefined();
    expect(normalizeModel('x'.repeat(200))).toBeUndefined();
  });
});

describe('HTTP routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    registerLenientJsonParser(app);
    app.register(chatRoutes, { prefix: '/api/chat' });
    app.register(feedRoutes, { prefix: '/api/feed' });
    app.register(aiTasksRoutes, { prefix: '/api/ai-tasks' });
    app.register(evolutionRoutes, { prefix: '/api/evolution' });
    app.post('/api/echo', async req => ({ body: req.body ?? null }));
    await app.ready();
  });

  beforeEach(() => mocks.routeTask.mockClear());

  it('POST /api/chat returns content (and response for older clients) and honours routing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat', payload: { messages: [{ role: 'user', content: 'hi' }], options: { routing: 'OPENCLAW' } } });
    expect(res.json()).toEqual({ role: 'assistant', content: 'hello', response: 'hello', usedNode: 'GEMINI' });
    expect(mocks.routeTask).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ routing: 'OPENCLAW' }) }));

    await app.inject({ method: 'POST', url: '/api/chat', headers: { 'x-routing': 'node_7' }, payload: { messages: [] } });
    expect(mocks.routeTask).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({ routing: 'node_7' }) }));

    expect((await app.inject({ method: 'POST', url: '/api/chat', payload: {} })).statusCode).toBe(400);
  });

  it('accepts an empty JSON body (installed APKs) but still blocks prototype poisoning', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/echo', headers: { 'content-type': 'application/json' }, payload: '' });
    expect(empty.statusCode).toBe(200);
    const poisoned = await app.inject({ method: 'POST', url: '/api/echo', headers: { 'content-type': 'application/json' }, payload: '{"__proto__":{"x":1}}' });
    expect(poisoned.statusCode).toBe(400);
  });

  it('DELETE /api/feed/:id removes an item (with an empty JSON body)', async () => {
    const id = 'feed-to-delete';
    FeedManager.addItem({ id, type: 'INSIGHT', content: 'to delete', created_at: Date.now() });
    const del = () => app.inject({ method: 'DELETE', url: `/api/feed/${id}`, headers: { 'content-type': 'application/json' }, payload: '' });
    expect((await del()).json()).toEqual({ success: true });
    expect((await del()).statusCode).toBe(404);
  });

  it('GET /api/ai-tasks/:id includes lastExecution like the list route', async () => {
    mocks.getTask.mockReturnValue({ id: 't1', title: 'T' });
    mocks.getExecutions.mockReturnValue([{ executionId: 'e2', status: 'completed' }, { executionId: 'e1', status: 'failed' }]);
    const res = await app.inject({ url: '/api/ai-tasks/t1' });
    expect(res.json().lastExecution).toEqual({ executionId: 'e2', status: 'completed' });
  });

  it('POST /api/evolution/candidates/:id/process forwards validated routing and model', async () => {
    await app.inject({ method: 'POST', url: '/api/evolution/candidates/c1/process', payload: { routing: 'OPENROUTER', model: 'bad model!' } });
    expect(mocks.processSpecificCandidate).toHaveBeenCalledWith('c1', { routing: 'OPENROUTER', model: undefined });
  });

  it('POST /api/evolution/protected-paths stores rows in the real schema', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/evolution/protected-paths', payload: { path: 'aimindmesh-server/src/x.ts', reason: 'test' } });
    expect(res.json()).toEqual({ success: true });
    const list = await app.inject({ url: '/api/evolution/protected-paths' });
    expect(list.json()).toEqual([expect.objectContaining({ path: 'aimindmesh-server/src/x.ts', reason: 'test' })]);
  });
});

describe('Gitea CI webhook registration', () => {
  it('updates an existing hook with the signing secret instead of duplicating it', async () => {
    vi.stubEnv('GITEA_URL', 'http://gitea.test');
    vi.stubEnv('GITEA_TOKEN', 'token');
    (config.autoEvolution as any).giteaWebhookSecret = 'whsec-test';
    const hookUrl = 'http://aimindmesh-server:3030/api/organization/webhooks/gitea';
    vi.spyOn(axios, 'get').mockResolvedValue({ data: [{ id: 7, config: { url: hookUrl } }] });
    const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: {} });
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

    await new GiteaOrganizationService().registerWebhook('aimindmesh-labs', 'demo');

    expect(post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith('http://gitea.test/api/v1/repos/aimindmesh-labs/demo/hooks/7',
      expect.objectContaining({ config: expect.objectContaining({ url: hookUrl, secret: 'whsec-test' }) }), expect.anything());
  });
});
