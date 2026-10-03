import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import db from '../../db/sqlite';
import { autoEvolutionPipeline } from '../../services/AutoEvolutionPipeline';
import { GiteaEvolutionService } from '../../services/GiteaEvolutionService';
import { feedbackService, FeedbackLabel } from '../../services/FeedbackService';
import { Logger } from '../../utils/Logger';
import { config } from '../../config';
import { normalizeRouting, normalizeModel } from '../../utils/routing';

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
      // Optional provider/model chosen in the admin UI (validated: they end up in router options)
      const body = (request.body ?? {}) as { routing?: unknown; model?: unknown };
      const options = { routing: normalizeRouting(body.routing), model: normalizeModel(body.model) };
      // Run in background but notify starting
      autoEvolutionPipeline.processSpecificCandidate(id, options).catch(err => {
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
      // Proposals are the audit trail of real changes: they are never deleted implicitly
      const proposals = db.prepare(`SELECT COUNT(*) AS c FROM evolution_proposals WHERE candidate_id = ?`).get(id) as { c: number };
      if (proposals.c > 0) return reply.code(409).send({ error: 'Candidate has proposals: delete them first' });
      db.transaction(() => {
        db.prepare(`DELETE FROM evolution_attempts WHERE candidate_id = ?`).run(id);
        db.prepare(`DELETE FROM evolution_candidates WHERE id = ?`).run(id);
      })();
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

      // 2. Delete from DB, with its review feedback (FK)
      db.transaction(() => {
        db.prepare(`DELETE FROM evolution_feedback WHERE proposal_id = ?`).run(id);
        db.prepare(`DELETE FROM evolution_proposals WHERE id = ?`).run(id);
      })();
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
    // Column is added_at (created_at made every insert fail)
    db.prepare(`INSERT INTO protected_paths (path, reason, added_at) VALUES (?, ?, ?)`)
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
    setImmediate(() => autoEvolutionPipeline.regenerateFromFeedback(id, { routing, model }).catch(err =>
      Logger.error('EvolutionRouter', `Regeneration failed for proposal ${id}: ${err.message}`)
    ));

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

  // POST /api/evolution/gitea/webhook lives in ./giteaWebhook.ts (needs the raw body for HMAC verification)
}
