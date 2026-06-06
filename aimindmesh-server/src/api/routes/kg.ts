import { FastifyInstance } from 'fastify';
import { KGManager } from '../../services/KGManager';
import { InferenceRouter } from '../../services/InferenceRouter';

export default async function (fastify: FastifyInstance) {
  fastify.post('/concepts', async (request, reply) => {
    const { name, description, tags } = request.body as any;
    const embedding = await InferenceRouter.getEmbeddings(`${name} ${description}`);
    const id = await KGManager.upsertConcept(name, description, embedding);
    return { id, name };
  });

  fastify.get('/search', async (request, reply) => {
    const { q, topK, type } = request.query as any;
    const queryEmbedding = await InferenceRouter.getEmbeddings(q);
    const results = await KGManager.semanticSearch(queryEmbedding, parseInt(topK) || 3, type);
    return { results: results.map(r => ({ ...r.node, labels: r.labels })) };
  });

  fastify.get('/stats', async () => {
    return await KGManager.getStats();
  });

  fastify.post('/explore', async (request) => {
    const { query, topK } = request.body as any;
    const queryEmbedding = await InferenceRouter.getEmbeddings(query);
    return await KGManager.neuralExplore(queryEmbedding, parseInt(topK) || 15);
  });

  fastify.delete('/nodes/:id', async (request) => {
    const { id } = request.params as any;
    await KGManager.deleteNode(id);
    return { ok: true };
  });

  fastify.get('/neighbors/:nodeId', async (request, reply) => {
    const { nodeId } = request.params as any;
    const { depth } = request.query as any;
    const results = await KGManager.getNeighbors(nodeId, parseInt(depth) || 1);
    return results;
  });

  fastify.post('/memories', async (request, reply) => {
    const { content, category, source } = request.body as any;
    const embedding = await InferenceRouter.getEmbeddings(content);
    const id = await KGManager.upsertMemory(content, embedding, category, source);
    return { id };
  });
}
