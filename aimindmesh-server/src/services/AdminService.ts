import fs from 'fs';
import path from 'path';
import os from 'os';
import { config, ServerConfig } from '../config';
import { NodeRegistry } from './NodeRegistry';
import crypto from 'crypto';
import db from '../db/sqlite';
import { Logger } from '../utils/Logger';
import { driver } from '../db/neo4j';
import * as FCMDispatcher from './FCMDispatcher';
import { ProactiveEngine } from './ProactiveEngine';
import { DebateEngine } from './DebateEngine';
import { InferenceRegistry } from './InferenceRegistry';
import { autoEvolutionPipeline } from './AutoEvolutionPipeline';
import { BackupService } from './BackupService';
import { OpenRouterService } from './OpenRouterService';
import { OpenClawHealthService } from './OpenClawHealthService';
import { HermesBridge } from './HermesBridge';


function deepMerge(target: any, source: any) {
  for (const key in source) {
    if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export class AdminService {
  public static getConfig(): ServerConfig {
    Logger.debug('Admin', 'Fetching server configuration');
    return config;
  }

  public static updateConfig(newConfigPartial: Partial<ServerConfig>): ServerConfig {
    const configPath = path.join(__dirname, '../../config.json');
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // ✅ CRITICAL BUG FIX [2026-04-15]: Use deep merge instead of shallow spread
    // This prevents partial updates to nested blocks (like 'ollama') from wiping out other settings.
    const merged = deepMerge(diskConfig, newConfigPartial);
    
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    
    // Update the exported config object in memory so runtime operations pick up changes instantly
    Object.assign(config, merged);
    
    // Hot-reload background services
    ProactiveEngine.start();
    DebateEngine.start();
    autoEvolutionPipeline.init();
    
    Logger.info('Admin', 'Server configuration persistently updated using Deep Merge and Hot-Reloaded');
    
    return merged as ServerConfig;
  }

  public static async deleteDocument(docId: string): Promise<void> {
    Logger.info('KG', `Deleting document and all associated chunks: ${docId}`);
    const session = driver.session();
  }

  private static getCPUUsage(): Promise<number> {
    const stats1 = os.cpus();
    return new Promise((resolve) => {
      setTimeout(() => {
        const stats2 = os.cpus();
        let totalIdle = 0, totalTick = 0;
        for (let i = 0; i < stats1.length; i++) {
          const start = stats1[i].times;
          const end = stats2[i].times;
          const idle = end.idle - start.idle;
          const total = (end.user - start.user) + (end.nice - start.nice) + (end.sys - start.sys) + (end.irq - start.irq) + (end.idle - start.idle);
          totalIdle += idle;
          totalTick += total;
        }
        resolve(Math.round(100 * (1 - totalIdle / totalTick)));
      }, 100);
    });
  }

  private static getRAMStats() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total: (total / (1024 ** 3)).toFixed(1) + ' GB',
      used: (used / (1024 ** 3)).toFixed(1) + ' GB',
      percent: Math.round((used / total) * 100)
    };
  }

  public static async getStatus() {
    const today = new Date().toISOString().split('T')[0];
    const stmtGemini = db.prepare('SELECT call_count FROM gemini_usage WHERE date = ?');
    const usageGemini = stmtGemini.get(today) as { call_count: number } | undefined;

    const stmtOR = db.prepare('SELECT call_count FROM openrouter_usage WHERE date = ?');
    const usageOR = stmtOR.get(today) as { call_count: number } | undefined;

    const nodes = NodeRegistry.getNodes().map(n => {
      let address = '10.2.0.1';
      try {
        if (n.ollama_url && n.ollama_url !== 'MOBILE_NODE') {
          const url = new URL(n.ollama_url);
          address = url.hostname;
        } else {
          // Tenta di recuperare l'IP dalla connessione WebSocket attiva
          const { InferenceRouter } = require('./InferenceRouter');
          const socket = InferenceRouter.nodeSockets.get(n.id.toUpperCase());
          if (socket && (socket as any)._socket) {
            address = (socket as any)._socket.remoteAddress?.replace('::ffff:', '') || '10.6.0.x';
          } else {
            // Fallback statico basato sulla topologia VPN
            address = n.id === 'SERVER_LOCAL' ? '10.2.0.1' : '10.6.0.x';
          }
        }
      } catch (e) {
        // Fallback per formati non-URL
        address = n.id === 'SERVER_LOCAL' ? '10.2.0.1' : (n.type === 'pc_client' ? 'vpn-client' : '10.6.0.x');
      }

      return {
        ...n,
        url: n.ollama_url || 'internal',
        address: address,
        name: n.name || n.id
      };
    });
    
    // ✅ STABILIZED HEALTH CHECK [2026-04-16]: Prevent model list flickering
    const localNode = nodes.find(n => n.id === 'SERVER_LOCAL');
    if (localNode) {
      try {
        const ollamaRes = await fetch(`${config.ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (ollamaRes.ok) {
          localNode.status = 'ONLINE';
          const data: any = await ollamaRes.json();
          // Only update if we actually got a non-empty list of models to prevent flickering to 'READY'
          if (data.models && data.models.length > 0) {
            localNode.models = data.models.map((m: any) => m.name);
          }
        } else {
          localNode.status = 'OFFLINE';
        }
      } catch (e) {
        // Log skip but keep existing registry status to avoid UI jitter during transient network blips
        Logger.debug('AdminService', 'Ollama health check skipped/timeout, preserving registry state');
      }
    }

    const cpu = await this.getCPUUsage();
    const ram = this.getRAMStats();

    const runningTasks = db.prepare("SELECT COUNT(*) as count FROM ingestion_jobs WHERE status = 'running'").get() as { count: number };
    
    const openClawHealth = OpenClawHealthService.getState();
    const hermesReachable = await HermesBridge.isReachable();
    const hermesHealth = {
      isHealthy: hermesReachable,
      statusMessage: hermesReachable ? 'Operational' : 'Offline / Unreachable',
      lastCheck: Date.now()
    };

    return {
      nodes,
      geminiUsage: usageGemini ? usageGemini.call_count : 0,
      openrouterUsage: usageOR ? usageOR.call_count : 0,
      cpu,
      ram,
      coreCount: os.cpus().length,
      fcmStatus: FCMDispatcher.isConfigured(),
      dailyQuotaCap: config.gemini.dailyQuotaCap || 100,
      openrouterDailyQuotaCap: config.openrouter.dailyQuotaCap || 100,
      inferenceQueue: InferenceRegistry.getActive(),
      runningTasksCount: runningTasks.count || 0,
      openrouterCredits: OpenRouterService.getCredits(),
      infrastructureBrake: config.infrastructureBrake,
      openClawHealth,
      hermesHealth,
      ingestionStats: await this.getIngestionStats()
    };

  }

  public static async getLogs(limit: number = 50, module?: string, level?: string) {
    try {
      let query = 'SELECT * FROM system_logs';
      const params: any[] = [];
      const conditions: string[] = [];

      if (module) {
        if (module.includes(',')) {
          const modules = module.split(',').map((m: string) => m.trim());
          const placeholders = modules.map(() => '?').join(',');
          conditions.push(`module IN (${placeholders})`);
          params.push(...modules);
        } else {
          conditions.push('module = ?');
          params.push(module);
        }
      }

      if (level && level !== 'ALL') {
        conditions.push('level = ?');
        params.push(level);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);
      
      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (e) {
      return [];
    }
  }

  public static getRawServerLogs(limit: number = 200) {
    return Logger.getRawLogs(limit);
  }

  public static async clearLogs() {
    try {
      db.prepare('DELETE FROM system_logs').run();
      Logger.info('Admin', 'System logs cleared manually via Admin Panel');
      return true;
    } catch (e) {
      return false;
    }
  }

  public static async reprocessInsight(insightId: string): Promise<boolean> {
    try {
      await DebateEngine.reprocessInsight(insightId);
      return true;
    } catch (e) {
      return false;
    }
  }

  public static getQueueHistory(limit: number = 100, status?: string) {
    try {
      let query = "SELECT * FROM inference_queue";
      const params: any[] = [];
      const conditions: string[] = [];
      
      const statusUpper = status?.toUpperCase();
      if (statusUpper === 'FAILED') {
        conditions.push("status IN ('FAILED', 'STALLED')");
      } else if (statusUpper === 'COMPLETED') {
        conditions.push("status = 'COMPLETED'");
      } else {
        conditions.push("status IN ('COMPLETED', 'FAILED', 'STALLED')");
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }

      query += " ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ?";
      params.push(limit);
      
      const stmt = db.prepare(query);
      return stmt.all(...params);
    } catch (e) {
      Logger.error('AdminService', 'Failed to fetch queue history: ' + (e as any).message);
      return [];
    }
  }

  public static async clearQueueHistory(status?: 'FAILED' | 'ALL'): Promise<boolean> {
    try {
      if (status === 'FAILED') {
        db.prepare("DELETE FROM inference_queue WHERE status IN ('FAILED', 'STALLED')").run();
        Logger.info('Admin', 'Failed inference history cleared manually');
      } else {
        db.prepare("DELETE FROM inference_queue WHERE status IN ('COMPLETED', 'FAILED', 'STALLED')").run();
        Logger.info('Admin', 'All inference history cleared manually');
      }
      return true;
    } catch (e) {
      Logger.error('AdminService', 'Failed to clear queue history: ' + (e as any).message);
      return false;
    }
  }

  public static async deleteTask(id: string): Promise<boolean> {
    try {
      db.prepare("DELETE FROM inference_queue WHERE id = ?").run(id);
      return true;
    } catch (e) {
      Logger.error('AdminService', `Failed to delete task ${id}: ` + (e as any).message);
      return false;
    }
  }

  public static async retryTask(id: string): Promise<boolean> {
    try {
      const row = db.prepare("SELECT * FROM inference_queue WHERE id = ?").get(id) as any;
      if (!row) throw new Error('Task not found');
      
      const { InferenceRouter } = require('./InferenceRouter');
      const payload = JSON.parse(row.payload);
      
      // Reset retry count and routing for manual retry
      if (payload) {
        payload.retryCount = 0;
        if (!payload.options) payload.options = {};
        payload.options.routing = 'AUTO';
      }

      // Cancel the old stalled/failed task to clean up the registry/UI
      InferenceRouter.cancelTask(id);

      // Delete the old failed task row from the database to clear it from Quarantine immediately
      db.prepare("DELETE FROM inference_queue WHERE id = ?").run(id);

      // We re-route it. This will create a NEW entry in history which is cleaner for manual retries
      void InferenceRouter.routeTask(payload);
      Logger.info('AdminService', `Manually retrying task [${id.slice(0,8)}]: ${row.task_name}`);
      return true;
    } catch (e) {
      Logger.error('AdminService', `Retry failed for task ${id}: ` + (e as any).message);
      return false;
    }
  }

  public static async restoreAllFailedTasks(): Promise<boolean> {
    try {
      const rows = db.prepare("SELECT * FROM inference_queue WHERE status = 'FAILED'").all() as any[];
      if (rows.length === 0) return true;

      const { InferenceRouter } = require('./InferenceRouter');

      for (const row of rows) {
        try {
          const payload = JSON.parse(row.payload);
          if (payload) {
            payload.retryCount = 0;
            if (!payload.options) payload.options = {};
            payload.options.routing = 'AUTO';
          }

          // Cancel the old task context
          InferenceRouter.cancelTask(row.id);

          // Delete the old failed row from quarantine database
          db.prepare("DELETE FROM inference_queue WHERE id = ?").run(row.id);

          // Re-route the task payload back to the active queue
          void InferenceRouter.routeTask(payload);
        } catch (err: any) {
          Logger.error('AdminService', `Failed to restore individual task ${row.id}: ` + err.message);
        }
      }
      Logger.info('AdminService', `Successfully restored ${rows.length} quarantined tasks back to the active queue.`);
      return true;
    } catch (e: any) {
      Logger.error('AdminService', 'Failed to restore all failed tasks: ' + e.message);
      return false;
    }
  }

  public static async reprocessAllMaintenance(): Promise<{ debates: number; insights: number }> {
    Logger.info('AdminService', 'Starting full maintenance reprocess cycle...');
    
    // 1. Debates
    const threads = db.prepare(`SELECT id, insight_id FROM debate_threads`).all() as { id: string, insight_id: string }[];
    let debateCount = 0;
    for (const thread of threads) {
      try {
        const history = (DebateEngine as any).buildHistoryContext(thread.id);
        if (history) {
          await DebateEngine.extractEvolutionConclusion(thread.insight_id, history);
          debateCount++;
        }
      } catch (e) {}
    }

    // 2. Insights
    const session = require('../db/neo4j').getSession();
    let insightCount = 0;
    try {
      const res = await session.run(`
        MATCH (i:Insight)
        WHERE i.source IS NULL OR i.type IS NULL
        RETURN i.id as id, i.content as content
      `);
      for (const record of res.records) {
        const id = record.get('id');
        const content = record.get('content');
        const severity = ProactiveEngine.calculateSeverity(content);
        await session.run(`
          MATCH (i:Insight {id: $id})
          SET i.severity = $severity, 
              i.processed = false,
              i.source = COALESCE(i.source, 'ProactiveEngine'),
              i.type = COALESCE(i.type, 'observation'),
              i.confidence = COALESCE(i.confidence, 0.7)
        `, { id, severity });
        insightCount++;
      }
    } finally {
      await session.close();
    }

    Logger.info('AdminService', `Maintenance complete: ${debateCount} debates and ${insightCount} insights reprocessed.`);
    return { debates: debateCount, insights: insightCount };
  }

  public static async listBackups() {
    return BackupService.listBackups();
  }

  public static async createBackup() {
    return BackupService.createBackup();
  }

  public static async restoreBackup(filename: string) {
    return BackupService.restoreBackup(filename);
  }

  public static async deleteBackup(filename: string) {
    return BackupService.deleteBackup(filename);
  }

  public static getBackupPath(filename: string) {
    return BackupService.getBackupPath(filename);
  }

  public static getTaskStats(unit: 'hour' | 'day' | 'total' = 'hour', hours?: number) {
    let format = '%Y-%m-%d %H:00';
    if (unit === 'day') format = '%Y-%m-%d';
    
    try {
      const timeLimit = hours ? Date.now() - hours * 60 * 60 * 1000 : 0;

      if (unit === 'total') {
        const stats = db.prepare(`
          SELECT 
            type, 
            provider, 
            status,
            count(*) as count,
            avg(completed_at - created_at) as avg_duration
          FROM inference_queue 
          WHERE created_at > ?
          GROUP BY type, provider, status
        `).all(timeLimit);
        return stats;
      }

      const query = `
        SELECT 
          strftime(?, created_at/1000, 'unixepoch', 'localtime') as time, 
          type, 
          provider, 
          status,
          count(*) as count 
        FROM inference_queue 
        WHERE created_at > ?
        GROUP BY time, type, provider, status 
        ORDER BY time DESC LIMIT 500
      `;
      
      const stmt = db.prepare(query);
      return stmt.all(format, timeLimit);
    } catch (e) {
      Logger.error('AdminService', 'Failed to fetch task stats: ' + (e as any).message);
      return [];
    }
  }

  public static async getExecutionHealth(hours: number = 24) {
    try {
      const timeLimit = Date.now() - hours * 60 * 60 * 1000;
      const stats = db.prepare(`
        SELECT 
          status,
          count(*) as count,
          avg(completed_at - created_at) as avg_duration
        FROM inference_queue 
        WHERE created_at > ?
        GROUP BY status
      `).all(timeLimit) as any[]; // all() instead of get() to handle multiple statuses
      
      const providerStats = db.prepare(`
        SELECT 
          provider,
          count(*) as count
        FROM inference_queue 
        WHERE created_at > ? AND status = 'COMPLETED'
        GROUP BY provider
      `).all(timeLimit);

      return {
        summary: stats,
        providers: providerStats,
        ingestionStats: await this.getIngestionStats(),
        timestamp: Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  public static async getIngestionStats(): Promise<Record<string, number>> {
    try {
      const stats = db.prepare(`
        SELECT status, count(*) as count 
        FROM ingestion_jobs 
        GROUP BY status
      `).all() as { status: string, count: number }[];

      return stats.reduce((acc, curr) => {
        acc[curr.status.toLowerCase()] = curr.count;
        return acc;
      }, {} as Record<string, number>);
    } catch (e) {
      Logger.error('AdminService', 'Failed to fetch ingestion stats: ' + (e as any).message);
      return {};
    }
  }

  public static toggleBrake(active: boolean): boolean {
    const { InferenceRouter } = require('./InferenceRouter');
    InferenceRouter.setBrake(active);
    
    // Persist to disk
    this.updateConfig({ infrastructureBrake: active });
    return active;
  }
}
