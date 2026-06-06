import { randomUUID, createHash } from 'crypto';
import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import pLimit from 'p-limit';
// @ts-ignore
import pdf from 'pdf-parse-fork';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import db from '../db/sqlite';
import { KGManager } from './KGManager';
import { InferenceRouter } from './InferenceRouter';
import { sendToDevice } from './FCMDispatcher';
import { config } from '../config';
import { Logger } from '../utils/Logger';
import { NodeRegistry } from './NodeRegistry';
import { DeliveryScheduler } from './DeliveryScheduler';
import { KnowledgeService } from './KnowledgeService';

// ─── Types ─────────────────────────────────────────────────────────────────

interface IngestJob {
  id: string;
  type: 'file' | 'url';
  source: string;       // file path (temp) or URL
  mimeType?: string;
  originalName: string;
  mode?: 'STANDARD' | 'DEEP';
  contentHash?: string;
}

export interface JobStatus {
  id: string;
  status: 'PENDING' | 'EXTRACTING' | 'CHUNKING' | 'VECTORIZING' | 'INDEXING' | 'DONE' | 'ERROR' | 'SKIPPED' | 'CANCELLED';
  docId?: string;
  source: string;
  totalChunks: number;
  doneChunks: number;
  progress: number; // For compatibility with existing UI (0-100)
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Main Service ───────────────────────────────────────────────────────────

export class DocumentIngester {
  private jobQueue: IngestJob[] = [];
  private isProcessing = false;
  private concurrentEmbeds = pLimit(2);
  private abortSignal = false;
  private currentDocId: string | null = null;

  constructor() {
    Logger.info('DocumentIngester', 'Service initialized with internal queue');
  }

  public initialize(): void {
    Logger.info('DocumentIngester', 'Resuming pending/cancelled jobs from persistent store...');
    this.restartIngestion();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Enqueue a file for ingestion. Returns jobId immediately. */
  public async enqueueFile(filePath: string, originalName: string, mimeType?: string, mode: 'STANDARD' | 'DEEP' = 'STANDARD'): Promise<string> {
    const jobId = randomUUID();
    const now = Date.now();
    Logger.debug('DocumentIngester', `Enqueuing process started: ${originalName} (Mode: ${mode})`);

    // Compute content hash for deduplication
    let contentHash: string | undefined;
    try {
      const buffer = await fs.readFile(filePath);
      contentHash = createHash('sha256').update(buffer).digest('hex');

      // Check for duplicate in the active SQLite queue first (pending/processing)
      const activeJob = db.prepare(
        `SELECT id, status FROM ingestion_jobs 
         WHERE (original_name = ? OR (content_hash = ? AND content_hash IS NOT NULL))
         AND status IN ('PENDING', 'EXTRACTING', 'CHUNKING', 'VECTORIZING', 'INDEXING')`
      ).get(originalName, contentHash ?? null) as any;

      if (activeJob) {
        Logger.debug('DocumentIngester', `Skipping duplicate file (already in active queue with status ${activeJob.status}): ${originalName}`);
        fs.unlink(filePath).catch(() => { });
        return activeJob.id;
      }

      // Check for duplicate by hash first
      const existingByHash = await KGManager.findDocumentByHash(contentHash);
      if (existingByHash) {
        Logger.debug('DocumentIngester', `Skipping duplicate file (hash match): ${originalName} → existing doc ${existingByHash.id}`);
        const chunks = existingByHash.chunkCount || 1;
        db.prepare(
          `INSERT INTO ingestion_jobs (id, status, type, source, original_name, mime_type, mode, content_hash, total_chunks, done_chunks, doc_id, error_msg, created_at, updated_at)
           VALUES (?, 'SKIPPED', 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(jobId, originalName, originalName, mimeType ?? null, mode, contentHash, chunks, chunks, existingByHash.id,
          `Duplicate: already indexed as "${existingByHash.title}" (hash match)`, now, now);
        fs.unlink(filePath).catch(() => { });
        return jobId;
      }

      // Check for duplicate by title as secondary guard
      const existingByTitle = await KGManager.findDocumentByTitle(originalName);
      if (existingByTitle) {
        Logger.debug('DocumentIngester', `Skipping duplicate file (title match): ${originalName} → existing doc ${existingByTitle.id}`);
        const chunks = existingByTitle.chunkCount || 1;
        db.prepare(
          `INSERT INTO ingestion_jobs (id, status, type, source, original_name, mime_type, mode, content_hash, total_chunks, done_chunks, doc_id, error_msg, created_at, updated_at)
           VALUES (?, 'SKIPPED', 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(jobId, originalName, originalName, mimeType ?? null, mode, contentHash, chunks, chunks, existingByTitle.id,
          `Duplicate: already indexed with same filename (title match)`, now, now);
        fs.unlink(filePath).catch(() => { });
        return jobId;
      }
    } catch (e: any) {
      Logger.warn('DocumentIngester', `Could not compute hash for ${originalName}: ${e.message}`);
    }

    // Ensure the file is persisted to data/ingest to survive restarts
    let finalPath = filePath;
    const ingestDir = path.join(__dirname, '../../data/ingest');
    try {
      if (!fs_sync.existsSync(ingestDir)) {
        fs_sync.mkdirSync(ingestDir, { recursive: true });
      }
      
      // If the file is in /tmp or not in ingestDir, move it
      if (!filePath.startsWith(ingestDir)) {
        const persistentPath = path.join(ingestDir, `${jobId}-${path.basename(filePath)}`);
        await fs.copyFile(filePath, persistentPath);
        await fs.unlink(filePath).catch(() => {});
        finalPath = persistentPath;
        Logger.debug('DocumentIngester', `File persisted to neural store: ${finalPath}`);
      }
    } catch (e: any) {
      Logger.error('DocumentIngester', `Failed to persist file ${filePath}: ${e.message}`);
      // Continue with original path, might fail on restart but better than failing now
    }

    try {
      db.prepare(
        `INSERT INTO ingestion_jobs (id, status, type, source, original_name, mime_type, mode, content_hash, created_at, updated_at)
         VALUES (?, 'PENDING', 'file', ?, ?, ?, ?, ?, ?, ?)`
      ).run(jobId, finalPath, originalName, mimeType ?? null, mode, contentHash ?? null, now, now);
    } catch (e: any) {
      Logger.error('DocumentIngester', `Critical failure writing to neural store: ${e.message}`);
      throw e;
    }

    this.jobQueue.push({ id: jobId, type: 'file', source: finalPath, mimeType, originalName, mode, contentHash });
    Logger.info('DocumentIngester', `File queued: ${originalName} (Job: ${jobId.slice(0, 8)}, Mode: ${mode})`);
    this.processQueue();
    return jobId;
  }

  /** Enqueue a URL for ingestion. Returns jobId immediately. */
  public async enqueueUrl(url: string, mode: 'STANDARD' | 'DEEP' = 'STANDARD'): Promise<string> {
    const jobId = randomUUID();
    const now = Date.now();

    // Check for duplicate in the active SQLite queue
    const activeJob = db.prepare(
      `SELECT id, status FROM ingestion_jobs 
       WHERE original_name = ? 
       AND status IN ('PENDING', 'EXTRACTING', 'CHUNKING', 'VECTORIZING', 'INDEXING')`
    ).get(url) as any;

    if (activeJob) {
      Logger.debug('DocumentIngester', `Skipping duplicate URL (already in active queue with status ${activeJob.status}): ${url}`);
      return activeJob.id;
    }

    // Check for duplicate by title (URL) as deduplication
    const existingByTitle = await KGManager.findDocumentByTitle(url);
    if (existingByTitle) {
      Logger.debug('DocumentIngester', `Skipping duplicate URL (title match): ${url}`);
      const chunks = existingByTitle.chunkCount || 1;
      db.prepare(
        `INSERT INTO ingestion_jobs (id, status, type, source, original_name, mode, total_chunks, done_chunks, doc_id, error_msg, created_at, updated_at)
         VALUES (?, 'SKIPPED', 'url', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(jobId, url, url, mode, chunks, chunks, existingByTitle.id, `Duplicate: URL already indexed`, now, now);
      return jobId;
    }

    db.prepare(
      `INSERT INTO ingestion_jobs (id, status, type, source, original_name, mode, created_at, updated_at)
       VALUES (?, 'PENDING', 'url', ?, ?, ?, ?, ?)`
    ).run(jobId, url, url, mode, now, now);

    this.jobQueue.push({ id: jobId, type: 'url', source: url, originalName: url, mode });
    Logger.info('DocumentIngester', `URL queued: ${url} (Job: ${jobId.slice(0, 8)}, Mode: ${mode})`);
    this.processQueue();
    return jobId;
  }

  /** Get current job status. */
  public getJobStatus(jobId: string): JobStatus | null {
    const row = db
      .prepare(`SELECT * FROM ingestion_jobs WHERE id = ?`)
      .get(jobId) as any;
    if (!row) return null;

    return this.rowToStatus(row);
  }

  /** List all documents. */
  public async listDocuments() {
    return KGManager.listDocuments();
  }

  /** Delete a document. */
  public async deleteDocument(docId: string): Promise<void> {
    await KGManager.deleteDocument(docId);
  }

  /** Delete multiple documents by IDs. */
  public async deleteDocuments(docIds: string[]): Promise<void> {
    await KGManager.deleteDocuments(docIds);
  }

  /** Delete all documents from the Knowledge Graph. */
  public async deleteAllDocuments(): Promise<void> {
    await KGManager.deleteAllDocuments();
  }

  /** List recent ingestion jobs. */
  public listRecentJobs(limit: number = 50): JobStatus[] {
    const rows = db
      .prepare(`SELECT * FROM ingestion_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map(row => this.rowToStatus(row));
  }

  /** Delete a job record. */
  public deleteJob(jobId: string): void {
    db.prepare(`DELETE FROM ingestion_jobs WHERE id = ?`).run(jobId);
    Logger.info('DocumentIngester', `Job record deleted: ${jobId}`);
  }

  /** Delete all completed, failed or cancelled job records. */
  public clearJobHistory(): void {
    db.prepare(`DELETE FROM ingestion_jobs WHERE status IN ('DONE', 'ERROR', 'CANCELLED', 'SKIPPED')`).run();
    Logger.info('DocumentIngester', 'Job history cleared.');
  }

  // ── Flow Control ────────────────────────────────────────────────────────

  /** Stop all pending and active ingestion. Leaves any partial progress intact. */
  public stopIngestion(): void {
    Logger.info('DocumentIngester', `Stop signal received. Clearing ${this.jobQueue.length} queued jobs.`);
    this.abortSignal = true;

    // Mark all queued jobs as CANCELLED in SQLite
    for (const job of this.jobQueue) {
      db.prepare(`UPDATE ingestion_jobs SET status='CANCELLED', updated_at=? WHERE id=?`)
        .run(Date.now(), job.id);
    }
    this.jobQueue = [];
  }

  /** Stop all ingestion AND delete the currently in-progress document partial data. */
  public async stopAndClearIngestion(): Promise<void> {
    const docIdToDelete = this.currentDocId;
    this.stopIngestion();
    if (docIdToDelete) {
      Logger.info('DocumentIngester', `Stop & Clear: removing partial document ${docIdToDelete}`);
      try {
        await KGManager.deleteDocument(docIdToDelete);
      } catch (e) {
        Logger.error('DocumentIngester', `Failed to delete partial document ${docIdToDelete}: ${e}`);
      }
    }
  }

  /** Restart ingestion — re-enqueue CANCELLED and remaining PENDING jobs from DB. */
  public restartIngestion(): void {
    this.abortSignal = false;
    this.currentDocId = null;

    const rows = db.prepare(
      `SELECT * FROM ingestion_jobs WHERE status IN ('CANCELLED', 'PENDING', 'EXTRACTING', 'CHUNKING', 'VECTORIZING', 'INDEXING') ORDER BY created_at ASC`
    ).all() as any[];

    if (rows.length === 0) {
      Logger.info('DocumentIngester', 'Restart called but no pending or interrupted jobs to re-queue.');
      return;
    }

    for (const row of rows) {
      // Avoid double-queuing
      if (this.jobQueue.some(j => j.id === row.id)) continue;

      db.prepare(`UPDATE ingestion_jobs SET status='PENDING', updated_at=? WHERE id=?`)
        .run(Date.now(), row.id);

      this.jobQueue.push({
        id: row.id,
        type: row.type,
        source: row.source,
        mimeType: row.mime_type ?? undefined,
        originalName: row.original_name ?? row.source,
        mode: row.mode ?? 'STANDARD',
        contentHash: row.content_hash ?? undefined,
      });
    }

    Logger.info('DocumentIngester', `Restart: ${rows.length} job(s) re-queued.`);
    this.processQueue();
  }

  // ── Queue Processing ────────────────────────────────────────────────────

  private processQueue(): void {
    if (this.isProcessing || this.jobQueue.length === 0) return;
    this.isProcessing = true;
    setImmediate(() => this.runNext());
  }

  private async runNext(): Promise<void> {
    const job = this.jobQueue.shift();
    if (!job) {
      this.isProcessing = false;
      return;
    }

    try {
      await this.runIngestion(job);
    } catch (err) {
      Logger.error('DocumentIngester', `Fatal error on job ${job.id}: ${err}`);
    }

    if (this.jobQueue.length > 0 && !this.abortSignal) {
      setImmediate(() => this.runNext());
    } else {
      this.isProcessing = false;
      if (this.abortSignal) {
        Logger.info('DocumentIngester', 'Abort signal consumed — queue processor halted.');
        this.abortSignal = false;
      }
    }
  }

  // ── Core Pipeline ───────────────────────────────────────────────────────

  private async runIngestion(job: IngestJob): Promise<void> {
    const updateJob = db.prepare(
      `UPDATE ingestion_jobs SET status=?, done_chunks=?, total_chunks=?, doc_id=?, error_msg=?, updated_at=? WHERE id=?`
    );

    const setStatus = (
      status: string,
      extra: {
        doneChunks?: number;
        totalChunks?: number;
        docId?: string;
        error?: string;
      } = {}
    ) => {
      updateJob.run(
        status,
        extra.doneChunks ?? 0,
        extra.totalChunks ?? 0,
        extra.docId ?? null,
        extra.error ?? null,
        Date.now(),
        job.id
      );
    };

    try {
      // 0. Safety Guard: Check file size before extraction
      if (job.type === 'file') {
        const stats = await fs.stat(job.source);
        const MAX_SIZE = 1024 * 1024; // 1MB Safety Cap
        if (stats.size > MAX_SIZE) {
          Logger.warn('DocumentIngester', `[${job.id}] Skipping oversized file: ${job.originalName} (${(stats.size / 1024).toFixed(1)} KB)`);
          setStatus('SKIPPED', { error: `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (Limit: 1MB)` });
          return;
        }
      }

      // 1. Text Extraction
      Logger.info('DocumentIngester', `[${job.id}] Extracting text from ${job.type === 'url' ? job.source : job.originalName}`);
      const rawText = await this.extractText(job);

      if (!rawText || rawText.length < 10) {
        throw new Error('Extracted text is empty or too short');
      }
      Logger.debug('DocumentIngester', `[${job.id}] Extraction successful: ${rawText.length} characters`);

      if (this.abortSignal) {
        setStatus('CANCELLED');
        return;
      }

      // 2. Chunking
      const chunkSize = (config.ingestion?.chunkSize || 512) * 4;
      const overlap = (config.ingestion?.chunkOverlap || 64) * 4;
      const chunks = this.chunkText(rawText, chunkSize, overlap);

      Logger.info('DocumentIngester', `[${job.id}] ${chunks.length} chunks created`);
      setStatus('CHUNKING', { totalChunks: chunks.length });

      if (this.abortSignal) {
        setStatus('CANCELLED');
        return;
      }

      // 3. Upsert Document in Neo4j
      setStatus('VECTORIZING', { totalChunks: chunks.length });
      const docId = randomUUID();
      this.currentDocId = docId;
      const title = job.type === 'url' ? job.source : job.originalName;

      await KGManager.upsertDocument({
        id: docId,
        title,
        source: job.source,
        mimeType: job.mimeType ?? 'text/plain',
        charCount: rawText.length,
        chunkCount: chunks.length,
        contentHash: job.contentHash,
      });

      // 4. Embed + Upsert Chunks
      let doneChunks = 0;
      await Promise.all(
        chunks.map((chunkText, idx) =>
          this.concurrentEmbeds(async () => {
            if (this.abortSignal) return;
            try {
              const embedding = await InferenceRouter.getEmbeddings(chunkText);
              const chunkId = randomUUID();

              await KGManager.upsertChunk({
                id: chunkId,
                docId,
                index: idx,
                text: chunkText,
                embedding,
              });

              // 5. Concept Extraction (Only for DEEP mode)
              if (job.mode === 'DEEP' && !this.abortSignal) {
                const concepts = await this.extractConcepts(chunkText);
                for (const conceptName of concepts) {
                  if (conceptName.length < 2) continue;
                  const conceptEmbedding = await InferenceRouter.getEmbeddings(conceptName);
                  const conceptId = await KGManager.upsertConcept(conceptName, `Extracted from ${title}`, conceptEmbedding);
                  if (conceptId) {
                    await KGManager.linkNodes(chunkId, conceptId, 'MENTIONS', 0.8);
                    // Enrich concept using web search in background
                    KnowledgeService.enrichConcept(conceptId).catch((e) => 
                      Logger.debug('DocumentIngester', `Background enrichment skipped for ${conceptName}: ${e.message}`)
                    );
                  }
                }
              }

              doneChunks++;
              Logger.debug('DocumentIngester', `[${job.id}] Chunk ${idx + 1}/${chunks.length} processed`);
              setStatus('INDEXING', { doneChunks, totalChunks: chunks.length, docId });
            } catch (e) {
              Logger.error('DocumentIngester', `Chunk ${idx} failed: ${e}`);
            }
          })
        )
      );

      if (this.abortSignal) {
        setStatus('CANCELLED', { doneChunks, totalChunks: chunks.length, docId });
        Logger.warn('DocumentIngester', `[${job.id}] Aborted mid-flight after ${doneChunks}/${chunks.length} chunks`);
        this.currentDocId = null;
        return;
      }

      setStatus('DONE', { doneChunks: chunks.length, totalChunks: chunks.length, docId });
      this.currentDocId = null;
      Logger.info('DocumentIngester', `[${job.id}] Completed successfully`);

      // Notify Mobile via DeliveryScheduler
      await DeliveryScheduler.deliver(
        docId,
        '✅ Document ready',
        title,
        'NOTIFICATION'
      );
      Logger.info('DocumentIngester', `[${job.id}] Notification handed over to DeliveryScheduler`);
    } catch (err: any) {
      this.currentDocId = null;
      Logger.error('DocumentIngester', `[${job.id}] Ingestion failed: ${err.message || err}`);
      const errorMsg = err.code?.includes('Unauthorized')
        ? 'Neural Database Access Denied (Unauthorized)'
        : (err.message || String(err));
      setStatus('ERROR', { error: errorMsg });
    } finally {
      if (job.type === 'file') {
        fs.unlink(job.source).catch(() => { });
      }
    }
  }

  private async extractText(job: IngestJob): Promise<string> {
    if (job.type === 'url') {
      const res = await fetch(job.source, { headers: { 'User-Agent': 'AIMindMesh/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${job.source}`);
      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, nav, footer, header').remove();
      return $('body').text().replace(/\s+/g, ' ').trim();
    }

    const buffer = await fs.readFile(job.source);
    
    // Safety Guard: Binary content detection
    const isBinary = buffer.slice(0, 1024).some(byte => byte === 0);
    if (isBinary && !job.originalName.endsWith('.pdf') && !job.originalName.endsWith('.docx')) {
      throw new Error('Binary content detected in non-supported document type');
    }

    if (job.mimeType === 'application/pdf' || job.originalName.endsWith('.pdf')) {
      const data = await pdf(buffer);
      return data.text;
    }
    if (job.mimeType?.includes('wordprocessingml') || job.originalName.endsWith('.docx')) {
      const res = await mammoth.extractRawText({ buffer });
      return res.value;
    }
    return buffer.toString('utf-8');
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        if (lastPeriod > start + (chunkSize * 0.8)) end = lastPeriod + 1;
      }
      chunks.push(text.slice(start, end).trim());
      start = end - overlap;
    }
    return chunks;
  }

  private async extractConcepts(text: string): Promise<string[]> {
    const prompt = `Extract exactly 5 key concepts, entities, or technical terms from this text. 
    You MUST output ONLY a JSON array of strings. Do not include any explanation or markdown.
    Format: ["Concept1", "Concept2", "Concept3", "Concept4", "Concept5"]
    
    Text: ${text.slice(0, 1500)}`;

    try {
      const res = await InferenceRouter.complete(prompt, 'CONCEPT_EXTRACTION', { taskName: 'Concept Extraction' });
      Logger.debug('DocumentIngester', `Raw concept extraction response: ${res}`);

      const match = res.match(/\[.*\]/s);
      if (match) {
        try {
          const concepts = JSON.parse(match[0]);
          return Array.isArray(concepts) ? concepts.slice(0, 5) : [];
        } catch (e) {
          Logger.warn('DocumentIngester', `Failed to parse extracted concepts JSON: ${e}`);
          return [];
        }
      }
      return [];
    } catch (err) {
      Logger.error('DocumentIngester', `Concept extraction failed: ${err}`);
      return [];
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private rowToStatus(row: any): JobStatus {
    return {
      id: row.id,
      status: row.status,
      docId: row.doc_id ?? undefined,
      source: row.original_name ?? row.source,
      totalChunks: row.total_chunks || 0,
      doneChunks: row.done_chunks || 0,
      progress:
        (row.total_chunks || 0) > 0
          ? Math.round((row.done_chunks / row.total_chunks) * 100)
          : 0,
      error: row.error_msg || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const documentIngester = new DocumentIngester();
