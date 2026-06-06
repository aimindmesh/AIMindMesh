import { FastifyInstance } from 'fastify';
import fs from 'fs';
import { AdminService } from '../../services/AdminService';
import { ProactiveEngine } from '../../services/ProactiveEngine';
import * as FCMDispatcher from '../../services/FCMDispatcher';
import { GiteaService } from '../../services/GiteaService';
import db from '../../db/sqlite';
import { Logger } from '../../utils/Logger';
import { InferenceRouter } from '../../services/InferenceRouter';
import { OpenRouterService } from '../../services/OpenRouterService';

export default async function (fastify: FastifyInstance) {
  fastify.get('/config', async (request, reply) => {
    const { DEFAULT_PARTICIPANTS } = require('../../services/DebateEngine');
    return { 
      config: AdminService.getConfig(),
      defaults: {
        debate: { participants: DEFAULT_PARTICIPANTS }
      }
    };
  });

  fastify.patch('/config', async (request, reply) => {
    try {
      const partialConfig = request.body as any;
      return { config: AdminService.updateConfig(partialConfig) };
    } catch (err: any) {
      reply.code(500).send({ error: err.message || 'Internal Server Error' });
      return reply;
    }
  });

  fastify.get('/status', async (request, reply) => {
    const status = await AdminService.getStatus();
    return { ...status, lastCycle: null };
  });

  fastify.get('/activity', async (request, reply) => {
    const { InferenceRegistry } = require('../../services/InferenceRegistry');
    return { activeInferences: InferenceRegistry.getActive() };
  });

  fastify.get('/logs', async (request, reply) => {
    const { limit, module, level } = request.query as any;
    return { logs: await AdminService.getLogs(parseInt(limit) || 50, module, level) };
  });

  fastify.get('/logs/raw', async (request, reply) => {
    const { limit } = request.query as any;
    reply.header('Content-Type', 'text/plain');
    return AdminService.getRawServerLogs(parseInt(limit) || 200);
  });

  fastify.delete('/logs', async (request, reply) => {
    const success = await AdminService.clearLogs();
    return { success };
  });

  fastify.post('/proactive/trigger', async (request, reply) => {
    const result = await ProactiveEngine.runCycle();
    return { ok: result.started, message: result.message || 'Cycle triggered successfully' };
  });

  fastify.post('/proactive/manual', async (request, reply) => {
    const { count } = request.body as any;
    const iterations = parseInt(count) || 1;
    
    Logger.info('AdminRouter', `Starting ${iterations} manual proactive cycles...`);
    
    // We run them sequentially to avoid overlapping same concepts if using same seed
    (async () => {
      for (let i = 0; i < iterations; i++) {
        await (ProactiveEngine as any).runCycle();
        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    })().catch(err => Logger.error('AdminRouter', 'Manual proactive iterations failed: ' + err.message));

    return { ok: true, message: `${iterations} cycles triggered asynchronously` };
  });

  fastify.post('/debate/merge', async (request, reply) => {
    const { DebateEngine } = require('../../services/DebateEngine');
    const result = await DebateEngine.runMergeCycle().catch((e: any) => {
      request.log.error('Manual merge cycle failed: ' + e.message);
      return { started: false, message: e.message };
    });
    return { ok: result.started, message: result.message || 'Merge cycle triggered successfully' };
  });

  fastify.post('/debate/reprocess', async (request, reply) => {
    const { DebateEngine } = require('../../services/DebateEngine');
    const { limit } = request.body as any;
    DebateEngine.reprocessRecentThreads(limit || 20).catch((e: any) => {
      Logger.error('AdminRouter', 'Manual reprocess failed: ' + e.message);
    });
    return { ok: true, message: 'Reprocess cycle triggered asynchronously' };
  });

  fastify.post('/debate/reprocess/:insightId', async (request, reply) => {
    const { insightId } = request.params as any;
    const success = await AdminService.reprocessInsight(insightId);
    if (success) {
      return { ok: true, message: 'Insight reprocessing triggered successfully' };
    } else {
      reply.code(400).send({ error: 'Failed to trigger reprocessing. Insight node or thread might be missing.' });
      return reply;
    }
  });
  
  fastify.post('/gitea/sync', async (request, reply) => {
    GiteaService.syncRepos();
    return { ok: true, message: 'Gitea repository sync triggered asynchronously' };
  });

  fastify.post('/wiki/trigger', async (request, reply) => {
    const { WikiSynthesisService } = require('../../services/WikiSynthesisService');
    const result = await WikiSynthesisService.runCycle().catch((e: any) => {
      Logger.error('AdminRouter', 'Manual Wiki synthesis failed: ' + e.message);
      return { error: e.message };
    });
    
    if (result.queued) {
      return { ok: true, message: 'Wiki synthesis cycle queued (another one is running)' };
    }
    return { ok: true, message: 'Wiki synthesis cycle triggered successfully' };
  });
  
  fastify.post('/wiki/force-save', async (request, reply) => {
    const { WikiManager } = require('../../services/WikiManager');
    const { title, body, tags, neo4jId } = request.body as any;
    
    if (!title || !body) {
        reply.code(400).send({ error: 'Title and body are required' });
        return reply;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    await WikiManager.savePage({
        slug,
        title,
        body,
        tags: tags || [],
        neo4jId: neo4jId || 'manual-recovery',
        updatedAt: new Date().toISOString()
    });
    await WikiManager.rebuildIndex();
    
    return { ok: true, slug };
  });

  fastify.delete('/nodes/prune', async (request, reply) => {
    const info = db.prepare("DELETE FROM nodes WHERE status = 'OFFLINE' AND id != 'SERVER_LOCAL'").run();
    return { ok: true, changes: info.changes };
  });

  fastify.post('/nodes/refresh', async (request, reply) => {
    const { config } = require('../../config');
    const { NodeRegistry } = require('../../services/NodeRegistry');
    await NodeRegistry.discoverAndRegisterLocalModels(config.ollama.baseUrl, config.ollama.defaultModel);
    return { ok: true, nodes: NodeRegistry.getNodes() };
  });

  fastify.get('/openrouter/credits', async (request, reply) => {
    return { credits: OpenRouterService.getCredits() };
  });

  fastify.post('/openrouter/credits/refresh', async (request, reply) => {
    const credits = await OpenRouterService.checkCredits();
    return { ok: !!credits, credits };
  });

  fastify.get('/openrouter/models', async (request, reply) => {
    const { InferenceProviders } = require('../../services/InferenceProviders');
    try {
      const models = await InferenceProviders.fetchOpenRouterModels();
      return { models };
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
      return reply;
    }
  });

  fastify.get('/fcm/logs', async (request, reply) => {
    const { limit } = request.query as any;
    const stmt = db.prepare('SELECT * FROM fcm_logs ORDER BY timestamp DESC LIMIT ?');
    const logs = stmt.all(parseInt(limit) || 50);
    return { logs }; 
  });

  fastify.get('/sync/logs', async (request, reply) => {
    const { limit } = request.query as any;
    const stmt = db.prepare('SELECT * FROM sync_logs ORDER BY timestamp DESC LIMIT ?');
    const logs = stmt.all(parseInt(limit) || 50);
    return { logs }; 
  });
  
  fastify.get('/stats/tasks', async (request, reply) => {
    const { unit, hours } = request.query as any;
    return { stats: AdminService.getTaskStats(unit || 'hour', hours ? parseInt(hours) : undefined) };
  });

  fastify.get('/stats/health', async (request, reply) => {
    const { hours } = request.query as any;
    return { health: await AdminService.getExecutionHealth(hours ? parseInt(hours) : 24) };
  });

  fastify.post('/fcm/test', async (request, reply) => {
    const { token } = request.body as any;
    if (!token) {
      reply.code(400).send({ error: 'Token is required' });
      return reply;
    }
    
    await FCMDispatcher.sendToDevice(token, {
      title: 'Synaptic Pulse Test',
      body: 'Testing notification gateway connectivity from Admin Panel.'
    });
    
    return { ok: true };
  });

  // --- QUEUE MANAGEMENT ---
  fastify.post('/queue/pause/:id', async (request, reply) => {
    const { id } = request.params as any;
    InferenceRouter.pauseTask(id);
    return { ok: true, status: 'PAUSED' };
  });

  fastify.post('/queue/resume/:id', async (request, reply) => {
    const { id } = request.params as any;
    InferenceRouter.resumeTask(id);
    return { ok: true, status: 'QUEUED' };
  });

  fastify.delete('/queue/cancel/:id', async (request, reply) => {
    const { id } = request.params as any;
    InferenceRouter.cancelTask(id);
    return { ok: true, status: 'CANCELLED' };
  });

  fastify.patch('/queue/:id', async (request, reply) => {
    const { id } = request.params as any;
    const { routing } = request.body as any;
    const success = InferenceRouter.updateQueuedTask(id, routing);
    return { ok: success };
  });

  fastify.get('/queue/history', async (request, reply) => {
    const { limit, status } = request.query as any;
    return { history: AdminService.getQueueHistory(parseInt(limit) || 100, status) };
  });

  fastify.delete('/queue/failed', async (request, reply) => {
    const success = await AdminService.clearQueueHistory('FAILED');
    return { success };
  });

  fastify.delete('/queue/history', async (request, reply) => {
    const success = await AdminService.clearQueueHistory('ALL');
    return { success };
  });

  fastify.delete('/queue/item/:id', async (request, reply) => {
    const { id } = request.params as any;
    const success = await AdminService.deleteTask(id);
    return { success };
  });

  fastify.post('/queue/retry/:id', async (request, reply) => {
    const { id } = request.params as any;
    const success = await AdminService.retryTask(id);
    return { ok: success };
  });

  fastify.post('/queue/restore-all', async (request, reply) => {
    const success = await AdminService.restoreAllFailedTasks();
    return { ok: success };
  });

  fastify.post('/queue/clear-locks', async (request, reply) => {
    InferenceRouter.clearLocks();
    return { ok: true, message: 'All inference locks cleared' };
  });

  fastify.post('/maintenance/reprocess', async (request, reply) => {
    try {
      const results = await AdminService.reprocessAllMaintenance();
      return results;
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
      return reply;
    }
  });

  fastify.post('/maintenance/brake', async (request, reply) => {
    const { active } = request.body as any;
    const result = AdminService.toggleBrake(active === true);
    return { ok: true, active: result };
  });

  // --- BACKUP MANAGEMENT ---
  fastify.get('/backups', async (request, reply) => {
    return { backups: await AdminService.listBackups() };
  });

  fastify.post('/backups', async (request, reply) => {
    const filename = await AdminService.createBackup();
    return { ok: true, filename };
  });

  fastify.get('/backups/download/:filename', async (request, reply) => {
    const { filename } = request.params as any;
    const filePath = AdminService.getBackupPath(filename);
    if (!fs.existsSync(filePath)) {
      reply.code(404).send({ error: 'Backup not found' });
      return reply;
    }
    const stream = fs.createReadStream(filePath);
    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return stream;
  });

  fastify.post('/backups/restore', async (request, reply) => {
    const { filename } = request.body as any;
    if (!filename) {
      reply.code(400).send({ error: 'Filename is required' });
      return reply;
    }
    try {
      await AdminService.restoreBackup(filename);
      return { ok: true, message: 'Restore initiated. Server state updated.' };
    } catch (err: any) {
      reply.code(500).send({ error: err.message });
      return reply;
    }
  });

  fastify.delete('/backups/:filename', async (request, reply) => {
    const { filename } = request.params as any;
    await AdminService.deleteBackup(filename);
    return { ok: true };
  });
}
