import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { DocumentIngester } from '../../services/DocumentIngester';
import { Logger } from '../../utils/Logger';
import { KGManager } from '../../services/KGManager';
import { InferenceRouter } from '../../services/InferenceRouter';
import db from '../../db/sqlite';

// ── Dependency Injection ───────────────────────────────────────────────────

export default async function (fastify: FastifyInstance, opts: { ingester: DocumentIngester }) {
  const { ingester } = opts;

  fastify.get('/', async () => {
    Logger.info('API', 'Listing documents');
    const documents = await ingester.listDocuments();
    return { documents };
  });

  fastify.post('/ingest/file', async (request: FastifyRequest, reply: FastifyReply) => {
    Logger.info('API', 'Neural file ingest pipeline triggered');
    try {
      Logger.info('API', 'Extracting synaptic payload from multipart stream...');
      const files = await request.saveRequestFiles();
      
      if (files.length === 0) {
        Logger.warn('API', 'Neural reject: No file detected in multipart stream');
        return reply.code(400).send({ error: 'No file uploaded' });
      }

      const file = files[0];
      const filename = file.filename;
      const mimetype = file.mimetype;
      const tmpPath = file.filepath;
      const mode = (file.fields.mode as any)?.value === 'DEEP' ? 'DEEP' : 'STANDARD';

      Logger.info('API', `Synaptic source handoff started: ${filename} (Mode: ${mode})`);
      const jobId = await ingester.enqueueFile(tmpPath, filename, mimetype, mode);
      
      Logger.info('API', `Synaptic source handoff complete: ${filename} (Job: ${jobId.slice(0, 8)})`);
      return { jobId };
    } catch (err: any) {
      Logger.error('API', 'Neural file ingest pipeline failure', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/ingest/url', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url, mode } = request.body as { url: string, mode?: string };
    if (!url) return reply.code(400).send({ error: 'No URL provided' });

    const extractionMode = mode === 'DEEP' ? 'DEEP' : 'STANDARD';
    const jobId = await ingester.enqueueUrl(url, extractionMode);
    Logger.debug('API', `Handed off URL ${url} to Ingester (Job: ${jobId}, Mode: ${extractionMode})`);
    return { jobId };
  });

  // ── Flow Control ─────────────────────────────────────────────────────────

  fastify.post('/ingest/stop', async (_request, _reply) => {
    Logger.info('API', 'Stop ingestion signal received');
    ingester.stopIngestion();
    return { ok: true, message: 'Ingestion queue cleared. Active job will halt at next checkpoint.' };
  });

  fastify.post('/ingest/stop-and-clear', async (_request, _reply) => {
    Logger.info('API', 'Stop & Clear ingestion signal received');
    await ingester.stopAndClearIngestion();
    return { ok: true, message: 'Ingestion stopped and partial document data cleared.' };
  });

  fastify.post('/ingest/restart', async (_request, _reply) => {
    Logger.info('API', 'Restart ingestion signal received');
    ingester.restartIngestion();
    return { ok: true, message: 'Ingestion restarted. Cancelled/pending jobs re-queued.' };
  });

  // ── Job Management ────────────────────────────────────────────────────────

  fastify.get('/jobs', async () => {
    Logger.debug('API', 'Listing recent ingestion jobs');
    const jobs = ingester.listRecentJobs(50);
    return { jobs };
  });

  fastify.get('/jobs/:jobId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = request.params as { jobId: string };
    const job = ingester.getJobStatus(jobId);
    if (!job) {
      Logger.warn('API', `Job probe failed: ${jobId} not found`);
      return reply.code(404).send({ error: 'Job not found' });
    }
    return job;
  });

  fastify.delete('/jobs', async () => {
    Logger.info('API', 'Clear ingestion job history signal received');
    ingester.clearJobHistory();
    return { ok: true };
  });

  fastify.delete('/jobs/:jobId', async (request: FastifyRequest) => {
    const { jobId } = request.params as { jobId: string };
    ingester.deleteJob(jobId);
    return { ok: true };
  });

  // ── Document Management ───────────────────────────────────────────────────

  fastify.get('/:id/chunks', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const chunks = await KGManager.getDocChunks(id);
    return { chunks };
  });

  fastify.post('/:id/sync-concepts', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { concepts } = request.body as { concepts: string[] };
    
    Logger.info('API', `Synchronizing ${concepts.length} pre-extracted concepts for reference ${id}`);
    
    // Resolve predicted DocId if 'id' is a JobId
    let finalDocId = id;
    const jobRow = db.prepare('SELECT doc_id FROM ingestion_jobs WHERE id = ?').get(id) as any;
    if (jobRow && jobRow.doc_id) {
        finalDocId = jobRow.doc_id;
        Logger.debug('API', `Resolved Job ID ${id} to Document ID ${finalDocId}`);
    }

    for (const conceptName of concepts) {
        if (conceptName.length < 2) continue;
        try {
            const conceptEmbedding = await InferenceRouter.getEmbeddings(conceptName);
            const conceptId = await KGManager.upsertConcept(conceptName, `Extracted via Hybrid Mobile/PC Client`, conceptEmbedding);
            if (conceptId) {
                await KGManager.linkNodes(finalDocId, conceptId, 'MENTIONS', 0.9);
            }
        } catch (e) {
            Logger.warn('API', `Failed to sync concept ${conceptName}: ${e}`);
        }
    }
    
    return { ok: true, synced: concepts.length, docId: finalDocId };
  });

  fastify.delete('/batch', async (request: FastifyRequest, reply: FastifyReply) => {
    const { docIds } = request.body as { docIds: string[] };
    if (!Array.isArray(docIds) || docIds.length === 0) {
      return reply.code(400).send({ error: 'docIds array is required' });
    }
    Logger.info('API', `Batch deleting ${docIds.length} document(s)`);
    await ingester.deleteDocuments(docIds);
    return { ok: true, deleted: docIds.length };
  });

  fastify.delete('/', async (_request, _reply) => {
    Logger.info('API', 'Delete ALL documents from Knowledge Graph');
    await ingester.deleteAllDocuments();
    return { ok: true, message: 'All documents cleared from Knowledge Graph.' };
  });

  fastify.delete('/:id', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await ingester.deleteDocument(id);
    return { ok: true };
  });
}
