import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import db from '../../db/sqlite';
import { autoEvolutionPipeline } from '../../services/AutoEvolutionPipeline';
import { GiteaEvolutionService } from '../../services/GiteaEvolutionService';
import { feedbackService, FeedbackLabel } from '../../services/FeedbackService';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';

export default async function evolutionRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  const gitea = new GiteaEvolutionService();

  // List all evolution proposals
  fastify.get('/proposals', async (request, reply) => {
    const rows = db.prepare(`
      SELECT p.*, c.title as candidate_title, c.description as candidate_description
      FROM evolution_proposals p
      LEFT JOIN evolution_candidates c ON p.candidate_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 100
    `).all();
    return rows;
  });

  // List all pending candidates
  fastify.get('/candidates', async (request, reply) => {
    const rows = db.prepare(`
      SELECT * FROM evolution_candidates 
      WHERE status = 'pending' OR status = 'failed'
      ORDER BY severity DESC
    `).all();
    return rows;
  });

  // Get single proposal details
  fastify.get('/proposals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare(`
      SELECT p.*, c.title as candidate_title, c.description as candidate_description, c.proposed_approach
      FROM evolution_proposals p
      LEFT JOIN evolution_candidates c ON p.candidate_id = c.id
      WHERE p.id = ?
    `).get(id);
    if (!row) return reply.code(404).send({ error: 'Proposal not found' });
    return row;
  });

  // Approve and merge proposal
  fastify.post('/proposals/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await gitea.mergeProposal(id);
      Logger.info('EvolutionRouter', `Proposal ${id} approved and merged.`);
      return { success: true };
    } catch (err: any) {
      Logger.error('EvolutionRouter', `Approval failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Reject proposal
  fastify.post('/proposals/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await gitea.rejectProposal(id);
      Logger.info('EvolutionRouter', `Proposal ${id} rejected and closed.`);
      return { success: true };
    } catch (err: any) {
      Logger.error('EvolutionRouter', `Rejection failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Trigger manual evolution cycle
  fastify.post('/cycle/run', async (request, reply) => {
    // Run in background
    autoEvolutionPipeline.runCycle(true).catch(err => {
      Logger.error('EvolutionRouter', `Manual cycle failed: ${err.message}`);
    });
    return { success: true, message: 'Evolution cycle started in background' };
  });

  // Process a specific candidate manually
  fastify.post('/candidates/:id/process', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // Run in background but notify starting
      autoEvolutionPipeline.processSpecificCandidate(id).catch(err => {
        Logger.error('EvolutionRouter', `Manual candidate processing failed: ${err.message}`);
      });
      return { success: true, message: 'Candidate processing started in background' };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Delete a candidate
  fastify.delete('/candidates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      db.prepare(`DELETE FROM evolution_candidates WHERE id = ?`).run(id);
      Logger.info('EvolutionRouter', `Candidate ${id} deleted manually.`);
      return { success: true };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Delete a proposal (and close PR)
  fastify.delete('/proposals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // 1. Try to reject/close in Gitea if it was 'proposed'
      const proposal = db.prepare(`SELECT status FROM evolution_proposals WHERE id = ?`).get(id) as any;
      if (proposal?.status === 'proposed') {
        try {
          await gitea.rejectProposal(id);
        } catch (e: any) {
          Logger.warn('EvolutionRouter', `Failed to close PR during proposal deletion: ${e.message}`);
        }
      }

      // 2. Delete from DB
      db.prepare(`DELETE FROM evolution_proposals WHERE id = ?`).run(id);
      Logger.info('EvolutionRouter', `Proposal ${id} deleted manually.`);
      return { success: true };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Protected paths management
  fastify.get('/protected-paths', async (request, reply) => {
    return db.prepare(`SELECT * FROM protected_paths`).all();
  });

  fastify.post('/protected-paths', async (request, reply) => {
    const { path, reason } = request.body as { path: string, reason?: string };
    db.prepare(`INSERT INTO protected_paths (path, reason, created_at) VALUES (?, ?, ?)`)
      .run(path, reason || '', Date.now());
    return { success: true };
  });

  fastify.delete('/protected-paths/:path', async (request, reply) => {
    const { path } = request.params as { path: string };
    db.prepare(`DELETE FROM protected_paths WHERE path = ?`).run(path);
    return { success: true };
  });

  // ── ★ NEW ENDPOINTS [v3.0]: PR Feedback Loop ────────────────────────────

  /**
   * POST /api/evolution/proposals/:id/feedback
   * Invia un feedback/commento e triggera opzionalmente la rigenerazione.
   */
  fastify.post('/proposals/:id/feedback', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { content, labels, autoTrigger = true } = request.body as {
      content: string;
      labels?: FeedbackLabel[];
      autoTrigger?: boolean;
    };

    if (!content?.trim()) {
      return reply.code(400).send({ error: 'content is required' });
    }

    try {
      const feedback = await feedbackService.saveFeedback(id, content, {
        author: (request as any).user?.username ?? 'developer',
        labels: labels ?? [],
        autoTrigger,
      });

      return {
        success: true,
        feedback,
        message: autoTrigger ? 'Feedback saved. Regeneration started.' : 'Feedback saved.'
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/evolution/proposals/:id/improve
   * Avvia manualmente la rigenerazione basata sui feedback esistenti.
   */
  fastify.post('/proposals/:id/improve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { routing, model } = (request.body as any) ?? {};

    // Non blocca — rigenerazione asincrona
    setImmediate(() => autoEvolutionPipeline.regenerateFromFeedback(id, { routing, model }));

    return { success: true, message: 'Improvement cycle started in background.' };
  });

  /**
   * GET /api/evolution/proposals/:id/feedback
   * Recupera tutti i feedback per una proposta.
   */
  fastify.get('/proposals/:id/feedback', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // Sync from Gitea before returning
      await gitea.syncPrCommentsToFeedback(id);

      const feedbacks = feedbackService.getFeedbackForProposal(id);
      const canIterate = feedbackService.canIterate(id);

      return { feedbacks, canIterate };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/evolution/gitea/webhook
   * Riceve i webhook da Gitea (es: Issue Comment).
   */
  fastify.post('/gitea/webhook', async (request, reply) => {
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
