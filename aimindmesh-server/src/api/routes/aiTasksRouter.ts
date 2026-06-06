/**
 * AI Tasks REST API (Fastify)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AiTaskScheduler } from '../../services/AiTaskScheduler';
import { AiModel, AiProvider, StoragePolicy, AiTaskDefinition } from '../../types/aiTask';
import { Logger } from '../../utils/Logger';

export default async function aiTasksRouter(fastify: FastifyInstance) {
  
  // ── Task CRUD ──────────────────────────────────────────────────────────────

  // List all tasks
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tasks = AiTaskScheduler.listTasks();
      // Enrich with the last execution for each task (required by mobile/pc spec)
      const tasksWithExec = tasks.map(task => {
        const executions = AiTaskScheduler.getExecutions(task.id);
        return {
          ...task,
          lastExecution: executions.length > 0 ? executions[0] : undefined
        };
      });
      return tasksWithExec;
    } catch (err: any) {
      Logger.error('aiTasksRouter', `GET /: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Create new task
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;

      if (!body.title || !body.promptTemplate) {
        return reply.code(400).send({ error: 'title and promptTemplate are required' });
      }

      const task = AiTaskScheduler.createTask({
        id:             body.id,
        title:          body.title,
        promptTemplate: body.promptTemplate,
        model:          (body.model as AiModel) ?? '',
        provider:       (body.provider as AiProvider) ?? 'auto',
        outputFormat:   body.outputFormat ?? 'markdown',
        storagePolicy:  (body.storagePolicy as StoragePolicy) ?? 'server_disk',
        requiresReview: body.requiresReview !== false,
        cronExpression: body.cronExpression ?? undefined,
        scheduledAt:    body.scheduledAt ?? undefined,
      });

      return reply.code(201).send(task);
    } catch (err: any) {
      Logger.error('aiTasksRouter', `POST /: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Update an existing task
  fastify.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      
      const task = AiTaskScheduler.updateTask(id, body as Partial<AiTaskDefinition>);
      return task;
    } catch (err: any) {
      Logger.error('aiTasksRouter', `PUT /:id: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Task detail
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const task = AiTaskScheduler.getTask(id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      return task;
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Delete task
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      AiTaskScheduler.deleteTask(id);
      return reply.code(204).send();
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Pause/Resume
  fastify.post('/:id/pause', async (request) => {
    const { id } = request.params as { id: string };
    AiTaskScheduler.pauseTask(id);
    return { success: true, status: 'paused' };
  });

  fastify.post('/:id/resume', async (request) => {
    const { id } = request.params as { id: string };
    AiTaskScheduler.resumeTask(id);
    return { success: true, status: 'active' };
  });

  // Manual execution
  fastify.post('/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const task = AiTaskScheduler.getTask(id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });

      reply.code(202).send({
        message: 'Execution started',
        taskId: id,
        note: 'Check GET /executions for status'
      });

      // Background execution
      AiTaskScheduler.executeTask(id).catch(err =>
        Logger.error('aiTasksRouter', `Manual task execution error ${id}: ${err.message}`)
      );
    } catch (err: any) {
      Logger.error('aiTasksRouter', `POST /:id/run: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── Executions ─────────────────────────────────────────────────────────────

  // Global archives (all tasks)
  fastify.get('/archives', async (request) => {
    const { limit } = (request.query as any);
    return AiTaskScheduler.getAllExecutions(limit ? parseInt(limit) : 100);
  });

  // Executions for a single task
  fastify.get('/:id/executions', async (request) => {
    const { id } = request.params as { id: string };
    return AiTaskScheduler.getExecutions(id);
  });

  // Delete a specific execution
  fastify.delete('/executions/:execId', async (request, reply) => {
    try {
      const { execId } = request.params as { execId: string };
      await AiTaskScheduler.deleteExecution(execId);
      return reply.code(204).send();
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });


  fastify.get('/:id/executions/:execId', async (request, reply) => {
    const { execId } = request.params as { execId: string };
    const exec = AiTaskScheduler.getExecution(execId);
    if (!exec) return reply.code(404).send({ error: 'Execution not found' });
    return exec;
  });

  fastify.post('/:id/executions/:execId/approve', async (request) => {
    const { execId } = request.params as { execId: string };
    AiTaskScheduler.approveExecution(execId);
    return { success: true, status: 'completed' };
  });

  fastify.get('/:id/executions/:execId/artifact', async (request, reply) => {
    const { execId } = request.params as { execId: string };
    const content = await AiTaskScheduler.readArtifact(execId);
    if (content === null) return reply.code(404).send({ error: 'Artifact not found' });
    
    return reply.type('text/plain; charset=utf-8').send(content);
  });

  // Shortcut for the last artifact (used by mobile client)
  fastify.get('/:id/artifact', async (request, reply) => {
    const { id } = request.params as { id: string };
    const executions = AiTaskScheduler.getExecutions(id);
    if (executions.length === 0 || !executions[0].artifactPath) {
      return reply.code(404).send({ error: 'No artifact available for this task' });
    }
    
    const content = await AiTaskScheduler.readArtifact(executions[0].executionId);
    if (content === null) return reply.code(404).send({ error: 'Unable to read latest artifact' });
    
    return reply.type('text/plain; charset=utf-8').send(content);
  });
}
