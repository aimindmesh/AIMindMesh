import { Logger } from '../utils/Logger';
import db from '../db/sqlite';

export interface ActiveInference {
  id: string;
  type: string;
  taskName?: string;
  startedAt: number;
  provider?: string;
  model?: string;
  status: 'QUEUED' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'STALLED' | 'WAITING';
  queuePosition?: number;
  payload?: any;
  processingStartedAt?: number;
  completedAt?: number;
  result?: string;
  errorMsg?: string;
  sourceId?: string;
}

export class InferenceRegistry {
  private static activeInferences = new Map<string, ActiveInference>();
 
  public static get(id: string): ActiveInference | undefined {
    return this.activeInferences.get(id);
  }

  public static register(id: string, type: string, taskName?: string, model?: string, payload?: any, provider?: string): void {
    const startedAt = Date.now();
    const info: ActiveInference = {
      id,
      type,
      taskName,
      startedAt,
      model,
      provider,
      status: 'QUEUED',
      payload,
      sourceId: payload?.metadata?.sourceId || payload?.sourceId
    };
    this.activeInferences.set(id, info);
    
    try {
      // Self-healing migration: Add provider column if missing
      const tableInfo = db.prepare('PRAGMA table_info(inference_queue)').all() as any[];
      if (!tableInfo.some(c => c.name === 'provider')) {
        db.exec('ALTER TABLE inference_queue ADD COLUMN provider TEXT');
        Logger.info('InferenceRegistry', 'Added provider column to inference_queue table');
      }
      if (!tableInfo.some(c => c.name === 'source_id')) {
        db.exec('ALTER TABLE inference_queue ADD COLUMN source_id TEXT');
      }
      if (!tableInfo.some(c => c.name === 'completed_at')) {
        db.exec('ALTER TABLE inference_queue ADD COLUMN completed_at INTEGER');
      }

      db.prepare(`
        INSERT INTO inference_queue (id, type, task_name, prompt, model, provider, status, payload, created_at, source_id)
        VALUES (@id, @type, @task_name, @prompt, @model, @provider, @status, @payload, @created_at, @source_id)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, provider=excluded.provider, model=excluded.model
      `).run({
        id,
        type,
        task_name: taskName || null,
        prompt: payload?.prompt || null,
        model: model || null,
        provider: provider || null,
        status: 'QUEUED',
        payload: payload ? JSON.stringify(payload) : null,
        created_at: startedAt,
        source_id: info.sourceId || null
      });
    } catch (err: any) {
      Logger.error('InferenceRegistry', 'DB insert failed: ' + err.message);
    }

    Logger.debug('InferenceRegistry', `Registered active inference: ${type} - ${taskName || 'unnamed'} [${id.slice(0, 8)}]`);
  }

  public static setStatus(id: string, status: ActiveInference['status'], queuePosition?: number): void {
    const info = this.activeInferences.get(id);
    if (info) {
      info.status = status;
      info.queuePosition = queuePosition;
      if (status === 'PROCESSING') {
        info.processingStartedAt = Date.now();
      }
      this.activeInferences.set(id, info);
      
      try {
        db.prepare('UPDATE inference_queue SET status = ? WHERE id = ?').run(status, id);
      } catch (err: any) {
        Logger.error('InferenceRegistry', 'DB status update failed: ' + err.message);
      }
    }
  }

  public static updateProvider(id: string, provider: string): void {
    const info = this.activeInferences.get(id);
    if (info) {
      Logger.debug('InferenceRegistry', `[SYNC] Provider for [${id.slice(0, 8)}] updated to ${provider}`);
      info.provider = provider;
      if (info.payload && info.payload.options) {
        info.payload.options.routing = provider;
      }
      this.activeInferences.set(id, info);
      
      try {
        db.prepare('UPDATE inference_queue SET provider = ?, payload = ? WHERE id = ?').run(
          provider, 
          info.payload ? JSON.stringify(info.payload) : null,
          id
        );
      } catch (err: any) {
        Logger.error('InferenceRegistry', 'DB provider update failed: ' + err.message);
      }
    }
  }

  public static update(id: string, model: string): void {
    const info = this.activeInferences.get(id);
    if (info) {
      info.model = model;
      this.activeInferences.set(id, info);
      
      try {
        db.prepare('UPDATE inference_queue SET model = ? WHERE id = ?').run(model, id);
      } catch (err: any) {
        Logger.error('InferenceRegistry', 'DB model update failed: ' + err.message);
      }
    }
  }
  public static updatePayload(id: string, payload: any): void {
    const info = this.activeInferences.get(id);
    if (info) {
      Logger.debug('InferenceRegistry', `[SYNC] Payload for [${id.slice(0, 8)}] updated. Routing: ${payload.options?.routing}`);
      info.payload = payload;
      if (payload.options?.routing) {
        const routing = payload.options.routing.toUpperCase();
        if (routing !== 'AUTO') {
          info.provider = payload.options.routing;
        }
      }
      if (payload.options?.model) {
          info.model = payload.options.model;
      }
      this.activeInferences.set(id, info);
      
      try {
        db.prepare('UPDATE inference_queue SET payload = ?, provider = ?, model = ? WHERE id = ?').run(
            JSON.stringify(payload), 
            info.provider || null,
            info.model || null,
            id
        );
      } catch (err: any) {
        Logger.error('InferenceRegistry', 'DB payload update failed: ' + err.message);
      }
    }
  }

  public static finish(id: string, result?: string, error?: string): void {
    const info = this.activeInferences.get(id);
    if (info) {
      const now = Date.now();
      info.status = error ? 'FAILED' : 'COMPLETED';
      info.result = result;
      info.errorMsg = error;
      info.completedAt = now;
      
      try {
        db.prepare('UPDATE inference_queue SET status = ?, result = ?, error_msg = ?, completed_at = ? WHERE id = ?')
          .run(info.status, result || null, error || null, now, id);
      } catch (err: any) {
        Logger.error('InferenceRegistry', 'DB finish update failed: ' + err.message);
      }
      this.activeInferences.delete(id);
      this.pruneHistory();
      Logger.debug('InferenceRegistry', `Finished inference: ${id.slice(0, 8)} [${error ? 'FAILED' : 'COMPLETED'}]`);
    }
  }

  private static pruneHistory(): void {
    try {
      const { config } = require('../config');
      const limit = config?.tasks?.retentionLimit || 1000;

      // 1. Prune COMPLETED tasks (standard limit)
      const compCount = db.prepare("SELECT COUNT(*) as cnt FROM inference_queue WHERE status = 'COMPLETED'").get() as any;
      if (compCount.cnt > limit) {
        const toDelete = compCount.cnt - limit;
        db.prepare(`
          DELETE FROM inference_queue 
          WHERE id IN (
            SELECT id FROM inference_queue 
            WHERE status = 'COMPLETED' 
            ORDER BY created_at ASC 
            LIMIT ?
          )
        `).run(toDelete);
      }

      // 2. Prune FAILED/STALLED tasks (larger limit to allow review)
      const failedLimit = limit * 2; 
      const failCount = db.prepare("SELECT COUNT(*) as cnt FROM inference_queue WHERE status IN ('FAILED', 'STALLED')").get() as any;
      if (failCount.cnt > failedLimit) {
        const toDelete = failCount.cnt - failedLimit;
        db.prepare(`
          DELETE FROM inference_queue 
          WHERE id IN (
            SELECT id FROM inference_queue 
            WHERE status IN ('FAILED', 'STALLED') 
            ORDER BY created_at ASC 
            LIMIT ?
          )
        `).run(toDelete);
      }
    } catch (err: any) {
      Logger.error('InferenceRegistry', 'Pruning failed: ' + err.message);
    }
  }

  public static unregister(id: string): void {
    this.finish(id);
  }

  public static getActive(): ActiveInference[] {
    return Array.from(this.activeInferences.values());
  }
}
