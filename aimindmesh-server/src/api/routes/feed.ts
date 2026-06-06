import { FastifyInstance } from 'fastify';
import { FeedManager } from '../../services/FeedManager';
import { InferenceRouter } from '../../services/InferenceRouter';

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const { limit, offset, unreadOnly } = request.query as any;
    return FeedManager.getFeed(parseInt(limit) || 20, parseInt(offset) || 0, unreadOnly === 'true');
  });

  fastify.post('/:id/read', async (request, reply) => {
    const { id } = request.params as any;
    FeedManager.markRead(id);
    return { ok: true };
  });

  fastify.post('/:id/reply', async (request, reply) => {
    const { id } = request.params as any;
    const { content } = request.body as any;
    const { DebateEngine } = require('../../services/DebateEngine');
    
    const debateThread = DebateEngine.getThreadByInsightId(id);
    if (debateThread) {
      const userReply = FeedManager.addReply(id, 'user', content);
      
      // Set headers for streaming
      reply.raw.setHeader('Content-Type', 'application/x-ndjson');
      reply.raw.setHeader('Transfer-Encoding', 'chunked');
      
      // Send initial user reply acknowledgement
      reply.raw.write(JSON.stringify({ type: 'user_reply', reply: userReply }) + '\n');

      try {
        await DebateEngine.injectHumanMessage(id, content, (msg: any) => {
          // Stream each agent message as it arrives
          reply.raw.write(JSON.stringify({ type: 'agent_reply', message: msg }) + '\n');
        });
      } catch (e: any) {
        request.log.error('Streaming debate failed: ' + e.message);
        reply.raw.write(JSON.stringify({ type: 'error', message: e.message }) + '\n');
      } finally {
        reply.raw.end();
      }
      return reply;
    }

    const userReply = FeedManager.addReply(id, 'user', content);
    
    const thread = FeedManager.getThread(id);
    const contextStr = thread.replies.map(r => `${r.role}: ${r.content}`).join('\n');
    
    const result = await InferenceRouter.routeTask({
      type: 'GENERAL_CHAT',
      prompt: `Context: ${thread.item.content}\n\nThread:\n${contextStr}\n\nTask: Reply to the user.`,
      tokensEstimate: 500,
      options: { taskName: 'Insight Follow-up Response' }
    });
    
    const assistantReply = FeedManager.addReply(id, 'assistant', result.response);
    
    return { reply: userReply, assistantReply };
  });

  fastify.post('/:id/debate/status', async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const { DebateEngine } = require('../../services/DebateEngine');

    try {
      await DebateEngine.updateThreadStatus(id, status);
      return { ok: true };
    } catch (e: any) {
      reply.status(404).send({ error: e.message });
    }
  });

  fastify.get('/:id/debate', async (request, reply) => {
    const { id } = request.params as any;
    const { DebateEngine } = require('../../services/DebateEngine');
    const messages = DebateEngine.getDebateMessages(id);
    const thread = DebateEngine.getThreadByInsightId(id);
    return { thread, messages };
  });

  fastify.get('/:id/thread', async (request, reply) => {
    const { id } = request.params as any;
    return FeedManager.getThread(id);
  });

  fastify.post('/trigger', async (request, reply) => {
    const { ProactiveEngine } = require('../../services/ProactiveEngine');
    // Run in background
    ProactiveEngine.runCycle().catch((err: any) => {
      console.error('Manual proactive cycle failed:', err);
    });
    return { ok: true, message: 'Proactive cycle triggered' };
  });
}
