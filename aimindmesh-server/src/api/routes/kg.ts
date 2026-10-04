import { FastifyInstance } from 'fastify';
import { KGManager } from '../../services/KGManager';
import { deleteMemoryBySyncId } from '../../services/KGMemories';
import { InferenceRouter } from '../../services/InferenceRouter';

/** Neo4j syncId of a phone fact (distinct from GlobalSync's `<deviceId>:<rowId>` memories) */
export const memoryFactSyncId = (id: string) => `fact:${id.trim()}`;

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

  /**
   * Body: { content, category?, source?, id?, createdAt? }. With `id` (a fact of the phone) the
   * same memory is updated on every sync instead of being duplicated.
   */
  fastify.post('/memories', async (request, reply) => {
    const { content, category, source, id: memoryId, createdAt } = (request.body ?? {}) as any;
    if (typeof content !== 'string' || !content.trim()) {
      reply.status(400).send({ error: 'content is required' });
      return;
    }
    const embedding = await InferenceRouter.getEmbeddings(content);
    const created = typeof createdAt === 'number' ? createdAt
      : typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : undefined;
    const syncId = typeof memoryId === 'string' && memoryId.trim() ? memoryFactSyncId(memoryId) : undefined;
    const id = await KGManager.upsertMemory(content, embedding, category ?? 'other', source ?? 'unknown', syncId, created);
    return { id };
  });

  /** The user deleted (or replaced) the memory on the phone */
  fastify.delete('/memories/:id', async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteMemoryBySyncId(memoryFactSyncId(id));
    return { ok: true, deleted };
  });
}
