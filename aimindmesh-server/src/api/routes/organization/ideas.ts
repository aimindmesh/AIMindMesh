import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditService } from './shared';
import { VentureDiscoveryService } from '../../../services/organization/VentureDiscoveryService';
import { AutonomousVentureEngine } from '../../../services/organization/AutonomousVentureEngine';
import { parseSources, saveDiscovered } from '../../../services/organization/venture/IdeaStore';
import { extractDirectivesFromSynthesis } from '../../../services/organization/venture/DirectiveExtractor';
import { approveForBuild, decideVenture, hasActiveBuild, LifecycleOutcome, startCouncilReview } from '../../../services/organization/venture/IdeaLifecycle';
import db from '../../../db/sqlite';

/** Venture ideas: CRUD, discovery, council review, human approval, directives, transition to development, design. */
export async function organizationIdeasRoutes(app: FastifyInstance) {
  // --- IDEAS ---
  app.get('/ideas', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ideas = db.prepare('SELECT * FROM organization_ideas ORDER BY created_at DESC').all();
      const parsedIdeas = ideas.map((row: any) => {
        let synthesis = row.analysis_synthesis || null;
        if (!synthesis) {
          const log = db.prepare(`
            SELECT payload FROM organization_audit_log 
            WHERE event_type = 'idea:review' AND target_id = ? 
            ORDER BY created_at DESC LIMIT 1
          `).get(row.id) as any;
          if (log && log.payload) {
            try {
              const payload = JSON.parse(log.payload);
              synthesis = payload.synthesis || null;
            } catch {}
          }
        }

        return {
          id: row.id,
          title: row.title,
          problemStatement: row.problem_statement || '',
          summary: row.summary || '',
          sourceSignals: JSON.parse(row.source_signals || '[]'),
          sources: parseSources(row.sources_json),
          strategicScore: row.strategic_score || 0,
          feasibilityScore: row.feasibility_score || 0,
          noveltyScore: row.novelty_score || 0,
          overallScore: row.overall_score || 0,
          status: row.status,
          analysisSynthesis: synthesis,
          humanFeedback: row.human_feedback || null,
          judgeRationale: row.judge_rationale || null,
          outcomeNotes: row.outcome_notes || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      });
      return { success: true, ideas: parsedIdeas };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const ideaId = `idea-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      db.prepare(`
        INSERT INTO organization_ideas (
          id, title, problem_statement, summary, source_signals, strategic_score, feasibility_score, novelty_score, overall_score, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ideaId,
        body.title || 'Untitled Idea',
        body.problemStatement || '',
        body.summary || '',
        JSON.stringify(body.sourceSignals || []),
        Number(body.strategicScore) || 50,
        Number(body.feasibilityScore) || 50,
        Number(body.noveltyScore) || 50,
        Number(body.overallScore) || 50,
        'proposed',
        new Date().toISOString(),
        new Date().toISOString()
      );

      await auditService.log({
        eventType: 'idea:create',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: { title: body.title }
      });

      return {
        success: true,
        idea: {
          id: ideaId,
          title: body.title,
          problemStatement: body.problemStatement || '',
          summary: body.summary || '',
          sourceSignals: body.sourceSignals || [],
          strategicScore: Number(body.strategicScore) || 50,
          feasibilityScore: Number(body.feasibilityScore) || 50,
          noveltyScore: Number(body.noveltyScore) || 50,
          overallScore: Number(body.overallScore) || 50,
          status: 'proposed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.put('/ideas/:ideaId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const body = request.body as any;
      const { title, problemStatement, summary } = body;
      
      const res = db.prepare(`
        UPDATE organization_ideas
        SET title = ?, problem_statement = ?, summary = ?, updated_at = ?
        WHERE id = ?
      `).run(title, problemStatement, summary, new Date().toISOString(), ideaId);

      if (res.changes === 0) {
        return reply.status(404).send({ error: 'Idea not found' });
      }

      await auditService.log({
        eventType: 'idea:update',
        actorType: 'human',
        actorId: 'operator',
        targetType: 'idea',
        targetId: ideaId,
        payload: { title }
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/discover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body ?? {}) as { topic?: unknown };
      const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim().slice(0, 300) : 'privacy-first developer tools';

      const discovery = new VentureDiscoveryService();
      const { saved, skipped } = saveDiscovered(await discovery.discoverIdeas(topic), AutonomousVentureEngine.getConfig().minScoreThreshold);

      for (const idea of saved) {
        await auditService.log({
          eventType: 'idea:discover',
          actorType: 'human',
          actorId: 'human',
          targetType: 'idea',
          targetId: idea.id,
          payload: { title: idea.title, topic, sources: idea.sources.length }
        });
      }

      return { success: true, ideas: saved, skipped };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // --- REVIEWS & DECISIONS ---
  const outcomeReply = (reply: FastifyReply, outcome: LifecycleOutcome, conflict: string) => {
    if (outcome === 'not_found') return reply.status(404).send({ error: 'Idea not found' });
    if (outcome === 'conflict') return reply.status(409).send({ error: conflict });
    return reply.status(202).send({ success: true });
  };

  // The council runs in the background (status `reviewing`, clients poll GET /ideas) and only votes
  app.post('/ideas/:ideaId/review', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const body = (request.body ?? {}) as { humanFeedback?: unknown };
      const feedback = typeof body.humanFeedback === 'string' ? body.humanFeedback.slice(0, 4000) : null;
      return outcomeReply(reply, startCouncilReview(ideaId, feedback), 'The idea is already under review or past the review stage');
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Human approval: the gate to characterization, repository and development agent
  app.post('/ideas/:ideaId/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      return outcomeReply(reply, await approveForBuild(ideaId, 'human'), 'The idea is already being built or under review');
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Once the MVP is ready (or to close a venture): continue, pivot or kill, with the owner's notes
  app.post('/ideas/:ideaId/decision', async (request: FastifyRequest, reply: FastifyReply) => {
    const { ideaId } = request.params as { ideaId: string };
    const body = (request.body ?? {}) as { decision?: unknown; notes?: unknown };
    if (body.decision !== 'continue' && body.decision !== 'pivot' && body.decision !== 'kill') {
      return reply.status(400).send({ error: 'decision must be continue, pivot or kill' });
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) : '';
    if (body.decision !== 'kill' && !notes) return reply.status(400).send({ error: 'notes are required to continue or pivot' });
    return outcomeReply(reply, decideVenture(ideaId, body.decision, notes), 'This decision is not possible in the current state of the idea');
  });

  app.delete('/ideas/:ideaId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const row = db.prepare('SELECT id FROM organization_ideas WHERE id = ?').get(ideaId);
      if (!row) return reply.status(404).send({ error: 'Idea not found' });
      if (hasActiveBuild(ideaId)) return reply.status(409).send({ error: 'A development run of this idea is in progress' });
      db.transaction(() => { // designs reference the idea (FK)
        db.prepare('DELETE FROM organization_product_designs WHERE idea_id = ?').run(ideaId);
        db.prepare('DELETE FROM organization_ideas WHERE id = ?').run(ideaId);
      })();

      await auditService.log({
        eventType: 'idea:delete',
        actorType: 'human', actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: {}
      });

      return { success: true };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.post('/ideas/:ideaId/generate-directives', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const ideaRow = db.prepare('SELECT * FROM organization_ideas WHERE id = ?').get(ideaId) as any;
      if (!ideaRow) {
        return reply.status(404).send({ error: 'Idea not found' });
      }

      let synthesis = ideaRow.analysis_synthesis || '';
      if (!synthesis) {
        const log = db.prepare(`
          SELECT payload FROM organization_audit_log 
          WHERE event_type = 'idea:review' AND target_id = ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(ideaId) as any;
        if (log && log.payload) {
          try {
            const payload = JSON.parse(log.payload);
            synthesis = payload.synthesis || '';
          } catch {}
        }
      }

      if (!synthesis) {
        return reply.status(400).send({ error: 'No debate summary found for this idea' });
      }

      const createdDirectives = await extractDirectivesFromSynthesis(ideaRow, synthesis);
      for (const directive of createdDirectives) {
        await auditService.log({
          eventType: 'directive:create',
          actorType: 'system',
          actorId: `council-debate:${ideaId}`,
          targetType: 'directive',
          targetId: directive.id,
          payload: { title: directive.title, derivedFromIdeaId: ideaId }
        });
      }

      await auditService.log({
        eventType: 'idea:generate-directives',
        actorType: 'human',
        actorId: 'human',
        targetType: 'idea',
        targetId: ideaId,
        payload: { count: createdDirectives.length }
      });

      return { success: true, directives: createdDirectives };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  // Same gate as /approve, from the "Transition to Development" button of an approved idea
  app.post('/ideas/:ideaId/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      return outcomeReply(reply, await approveForBuild(ideaId, 'human'), 'The idea is already being built or under review');
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });

  app.get('/ideas/:ideaId/design', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ideaId } = request.params as { ideaId: string };
      const row = db.prepare('SELECT * FROM organization_product_designs WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as any;
      if (!row) {
        return reply.status(404).send({ error: 'Design not found' });
      }
      return {
        id: row.id,
        ideaId: row.idea_id,
        scopeAndAudience: row.scope_and_audience,
        uiUxDesign: row.ui_ux_design,
        coreLogic: row.core_logic,
        techStack: row.tech_stack,
        rawMarkdown: row.raw_markdown,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (e: any) {
      reply.status(500).send({ error: e.message });
    }
  });
}
