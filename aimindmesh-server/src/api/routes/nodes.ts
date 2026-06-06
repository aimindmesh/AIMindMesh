import { FastifyInstance } from 'fastify';
import { NodeRegistry } from '../../services/NodeRegistry';
import { Logger } from '../../utils/Logger';

export default async function (fastify: FastifyInstance) {
  fastify.post('/register', async (request, reply) => {
    const body = request.body as any;
    Logger.info('NodeRegistry', `HTTP Registration attempt from ${request.ip} for node ${body.id}`);
    
    // Auto-patch IP for tunnel routing (NAT traversal)
    const ollamaUrl = body.ollama_url || body.ollamaUrl;
    if (ollamaUrl) {
      try {
        const url = new URL(ollamaUrl);
        // Only patch if it's a loopback/local address (meaning the node doesn't know its public/VPN IP)
        // If it's already a VPN IP (10.6.x.x), we trust the node's own detection
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          url.hostname = request.ip;
          body.ollama_url = url.toString();
          body.ollamaUrl = url.toString();
          Logger.info('NodeRegistry', `Auto-resolved registration URL to ${body.ollama_url} for ${body.id}`);
        } else {
          Logger.info('NodeRegistry', `Trusting node-provided URL: ${ollamaUrl}`);
        }
      } catch (e) {
        Logger.warn('NodeRegistry', `Failed to parse ollamaUrl for IP patching: ${ollamaUrl}`);
      }
    }

    NodeRegistry.registerNode(body);
    return { ok: true };
  });

  fastify.post('/heartbeat', async (request, reply) => {
    const body = request.body as { id: string };
    NodeRegistry.heartbeat(body.id);
    return { ok: true };
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = require('../../db/sqlite').default;
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    return { ok: true };
  });

  fastify.get('/', async (request, reply) => {
    return { nodes: NodeRegistry.getNodes() };
  });
}
