import { FastifyInstance } from 'fastify';
import { InferenceRouter, TaskType } from '../../services/InferenceRouter';
import { NodeRegistry } from '../../services/NodeRegistry';
import db from '../../db/sqlite';

export default async function (fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const body = request.body as { messages: {role:string, content:string}[], stream?: boolean, taskType?: TaskType };
    
    const prompt = body.messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const taskType = body.taskType || 'GENERAL_CHAT';
    const tokensEstimate = prompt.length / 4;
    
    const Logger = require('../../utils/Logger').Logger;
    Logger.debug('ChatAPI', `New REST request: type=${taskType}, promptLen=${prompt.length}`);

    try {
      const result = await InferenceRouter.routeTask({
        type: taskType,
        prompt,
        tokensEstimate,
        options: { taskName: 'User Chat Response' }
      });
      return { role: 'assistant', content: result.response, usedNode: result.provider };
    } catch (e: any) {
      reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/provider', async (request, reply) => {
    const nodes = NodeRegistry.getNodes().filter((n:any) => n.status === 'ONLINE');
    const pcNode = nodes.find((n:any) => n.type === 'pc_client' || n.id === 'LAPTOP');
    const localOllama = nodes.find((n:any) => n.id === 'SERVER_LOCAL' || n.type === 'server');
    
    // Honor configuration preference
    const preferred = (require('../../config').config.routing?.preferredNode || 'AUTO') as string;
    
    if (preferred === 'SERVER_LOCAL' && localOllama) return { activeNode: 'SERVER_LOCAL' };
    if (preferred !== 'AUTO' && nodes.find((n:any) => n.id.toUpperCase() === preferred.toUpperCase())) return { activeNode: preferred };
    
    // Default fallback priority: PC -> Server Ollama -> Gemini
    const active = pcNode ? pcNode.id : localOllama ? 'SERVER_LOCAL' : 'GEMINI_API';
    const Logger = require('../../utils/Logger').Logger;
    Logger.debug('ChatAPI', `Calculated active node: ${active} (preferred=${preferred})`);
    return { activeNode: active };
  });

  // Conversations REST API
  fastify.get('/conversations', async () => {
    const rows = db.prepare('SELECT * FROM conversations ORDER BY last_message_at DESC').all();
    return { conversations: rows };
  });

  fastify.delete('/conversations/:id', async (req: any) => {
    db.prepare('DELETE FROM direct_chats WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  fastify.patch('/conversations/:id', async (req: any) => {
    const { title } = req.body as any;
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, req.params.id);
    return { ok: true };
  });
}
