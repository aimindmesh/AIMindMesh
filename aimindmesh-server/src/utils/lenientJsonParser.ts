import { FastifyInstance } from 'fastify';

/**
 * Accepts an empty body sent with `Content-Type: application/json` (installed mobile APKs
 * do this on DELETE), keeping Fastify's default parser, and its prototype-poisoning
 * protection, for every non-empty body.
 */
export function registerLenientJsonParser(fastify: FastifyInstance) {
  const defaultParser = fastify.getDefaultJsonParser('error', 'error');
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body === 'string' && body.trim() === '') return done(null, undefined);
    defaultParser(request, body as string, done);
  });
}
