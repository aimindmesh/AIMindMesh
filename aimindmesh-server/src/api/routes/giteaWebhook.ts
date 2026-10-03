import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import db from '../../db/sqlite';
import { feedbackService } from '../../services/FeedbackService';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';
import { safeEqual } from '../../middleware/auth';

/**
 * Gitea webhook receivers. They are exempt from the API key (see middleware/auth.ts)
 * and authenticated instead by the HMAC signature Gitea sends in X-Gitea-Signature,
 * computed over the raw body with autoEvolution.giteaWebhookSecret.
 */

/** Encapsulated JSON parser that keeps the raw body for signature verification (this plugin's routes only). */
function registerRawJsonParser(fastify: FastifyInstance) {
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    (request as any).rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf-8')) : {});
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
}

export function verifyGiteaSignature(request: FastifyRequest): { ok: true } | { ok: false; error: string } {
  const secret = config.autoEvolution?.giteaWebhookSecret;
  if (!secret) return { ok: false, error: 'Webhook secret not configured' };

  const signature = request.headers['x-gitea-signature'];
  const rawBody: Buffer = (request as any).rawBody ?? Buffer.alloc(0);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (typeof signature !== 'string' || !safeEqual(signature, expected)) return { ok: false, error: 'Invalid signature' };
  return { ok: true };
}

/** Auto-evolution PR comments, mounted under /api/evolution. */
export default async function giteaWebhookRoutes(fastify: FastifyInstance) {
  registerRawJsonParser(fastify);

  /**
   * POST /api/evolution/gitea/webhook
   * Riceve i webhook da Gitea (es: Issue Comment).
   */
  fastify.post('/gitea/webhook', async (request, reply) => {
    const verification = verifyGiteaSignature(request);
    if (!verification.ok) {
      Logger.warn('EvolutionRouter', `Webhook rejected from ${request.ip}: ${verification.error}`);
      return reply.code(401).send({ error: verification.error });
    }

    // Rispondi subito (evita timeout Gitea)
    reply.code(200).send({ received: true });

    try {
      const event = request.headers['x-gitea-event'];
      const payload = request.body as any;

      Logger.info('EvolutionRouter', `Webhook received - Event: ${event}, Action: ${payload?.action}`);

      if (event !== 'issue_comment') return;
      if (payload.action !== 'created') return;
      if (!payload.issue?.pull_request) {
         Logger.info('EvolutionRouter', `Webhook ignored: not a pull request comment.`);
         return;
      }

      const prNumber = payload.issue.number;
      const comment = payload.comment?.body ?? '';
      const author = payload.comment?.user?.login ?? 'unknown';

      // Trova proposta corrispondente
      const proposal = db.prepare(`SELECT id FROM evolution_proposals WHERE pr_number = ?`)
        .get(prNumber) as any;

      if (!proposal) {
        Logger.info('EvolutionRouter', `Webhook ignored: No proposal found for PR #${prNumber}`);
        return;
      }

      Logger.info('EvolutionRouter', `Ingesting Gitea comment for PR #${prNumber}`);
      await feedbackService.ingestGiteaComment(proposal.id, comment, author);
    } catch (err: any) {
      Logger.error('EvolutionRouter', `Webhook error: ${err.message}`);
    }
  });
}

/** CI/CD events (workflow_run / check_run) of the organization's project repos, mounted under /api/organization. */
export async function giteaCiWebhookRoutes(fastify: FastifyInstance) {
  registerRawJsonParser(fastify);

  fastify.post('/webhooks/gitea', async (request, reply) => {
    const verification = verifyGiteaSignature(request);
    if (!verification.ok) {
      Logger.warn('OrganizationWebhook', `CI webhook rejected from ${request.ip}: ${verification.error}`);
      return reply.code(401).send({ error: verification.error });
    }
    try {
      const { VentureOrchestrator } = await import('../../services/organization/VentureOrchestrator');
      VentureOrchestrator.handleCiWebhook(request.body as any);
      return reply.status(200).send({ ok: true });
    } catch (e: any) {
      // Always return 200 to prevent Gitea from disabling the webhook
      return reply.status(200).send({ ok: false, error: e.message });
    }
  });
}
