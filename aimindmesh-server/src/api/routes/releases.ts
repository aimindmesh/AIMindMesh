import { FastifyInstance } from 'fastify';
import { ReleaseService } from '../../services/ReleaseService';

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const versions = await ReleaseService.getVersions();
    return { versions };
  });

  fastify.get('/latest', async (request, reply) => {
    const versions = await ReleaseService.getVersions();
    return {
      pc: versions.pc?.version || '0.0.0',
      android: versions.android?.version || '0.0.0'
    };
  });
}
