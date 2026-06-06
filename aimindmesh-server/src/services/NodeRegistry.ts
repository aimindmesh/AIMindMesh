import db from '../db/sqlite';
import { Logger } from '../utils/Logger';

export interface NodeInfo {
  id: string;
  type: 'pc_client' | 'mobile' | 'server';
  status: 'ONLINE' | 'OFFLINE';
  ollama_url?: string;
  models?: string[];
  fcm_token?: string;
  name?: string;
  last_heartbeat: number;
}

export class NodeRegistry {
  public static registerNode(data: Partial<NodeInfo> & { ollamaUrl?: string; fcmToken?: string }) {
    const nodeId = (data.id || 'SERVER_LOCAL').trim().toUpperCase();
    Logger.info('NodeRegistry', `Node registering: ${nodeId}`, { type: data.type, url: data.ollama_url || data.ollamaUrl });
    const stmt = db.prepare(`
      INSERT INTO nodes (id, type, status, ollama_url, models, fcm_token, name, last_heartbeat, registered_at)
      VALUES (@id, @type, 'ONLINE', @ollamaUrl, @models, @fcmToken, @name, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        status = 'ONLINE',
        ollama_url = @ollamaUrl,
        models = @models,
        fcm_token = COALESCE(@fcmToken, fcm_token),
        name = COALESCE(@name, name),
        last_heartbeat = @now
    `);
    
    // Transition Cleanup: If we're registering with a name (e.g. "ZFOLD5") 
    // and there's a legacy node whose ID is that same name, delete the legacy one.
    if (data.name) {
      const legacyId = data.name.trim().toUpperCase();
      if (legacyId !== nodeId) {
        db.prepare('DELETE FROM nodes WHERE id = ?').run(legacyId);
        Logger.info('NodeRegistry', `Cleaned up legacy node [${legacyId}] (Replaced by ${nodeId})`);
      }
    }
    
    stmt.run({
      id: nodeId,
      type: data.type,
      ollamaUrl: data.ollama_url || data.ollamaUrl || null,
      models: data.models ? JSON.stringify(data.models) : null,
      fcmToken: data.fcm_token || data.fcmToken || null,
      name: data.name || null,
      now: Date.now()
    });
  }

  /** Special registration for the server itself to ensure it's always in the registry */
  public static async discoverAndRegisterLocalModels(ollamaUrl: string, defaultModel?: string) {
    Logger.info('NodeRegistry', `Starting dynamic model discovery at ${ollamaUrl}...`);
    let models: string[] = [];
    
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`);
      if (response.ok) {
        const data = await response.json() as { models: { name: string }[] };
        models = data.models
          .map(m => m.name)
          .filter(name => !name.includes('embed') && !name.includes('nomic')); // Filter out embedding models
        Logger.info('NodeRegistry', `Discovered ${models.length} models on Ollama: ${models.join(', ')}`);
      } else {
        Logger.warn('NodeRegistry', `Ollama returned error ${response.status}. Falling back to default.`);
      }
    } catch (e: any) {
      Logger.error('NodeRegistry', `Ollama connection FAILED at ${ollamaUrl}. Node remains in OFFLINE/STALE state. Error: ${e.message}`);
      // If totally unreachable, we still register the node but with a warning status if we could
    }

    // Fallback if no models discovered
    if (models.length === 0 && defaultModel) {
      models = [defaultModel];
    }

    this.registerNode({
      id: 'SERVER_LOCAL',
      type: 'server',
      ollama_url: ollamaUrl,
      models: models
    });
  }

  public static registerServerSelf(ollamaUrl: string, models: string[] = []) {
    Logger.info('NodeRegistry', 'Self-registering AIMindMesh Server node (Manual fallback)...');
    this.registerNode({
      id: 'SERVER_LOCAL',
      type: 'server',
      ollama_url: ollamaUrl,
      models: models
    });
  }

  public static heartbeat(id: string) {
    const nodeId = id.trim().toUpperCase();
    Logger.debug('NodeRegistry', `Heartbeat received from ${nodeId}`);
    const stmt = db.prepare(`UPDATE nodes SET last_heartbeat = ?, status = 'ONLINE' WHERE id = ?`);
    const info = stmt.run(Date.now(), nodeId);
    if (info.changes === 0) {
      Logger.warn('NodeRegistry', `Heartbeat from unknown node: ${nodeId}`);
    }
  }

  public static getNodes(): NodeInfo[] {
    const stmt = db.prepare(`SELECT * FROM nodes`);
    const results = stmt.all() as any[];
    Logger.debug('NodeRegistry', `Registry dump: ${results.map(n => `${n.id}:${n.status}`).join(', ')}`);
    return results.map(row => ({
      ...row,
      id: row.id.toUpperCase(),
      models: row.models ? JSON.parse(row.models) : []
    }));
  }

  public static updateStatus(id: string, status: 'ONLINE' | 'OFFLINE') {
    const nodeId = id.trim().toUpperCase();
    const stmt = db.prepare(`UPDATE nodes SET status = ? WHERE id = ?`);
    stmt.run(status, nodeId);
    Logger.info('NodeRegistry', `Node [${nodeId}] status forced to ${status}`);
  }

  public static checkStaleNodes() {
    const now = Date.now();
    const timeout = 180 * 1000; // 180 seconds (3 minutes)
    const staleThreshold = now - timeout;
    Logger.debug('NodeRegistry', `Checking for stale nodes (threshold: ${new Date(staleThreshold).toISOString()})`);
    const stmt = db.prepare(`UPDATE nodes SET status = 'OFFLINE' WHERE status = 'ONLINE' AND last_heartbeat < ?`);
    const info = stmt.run(staleThreshold);
    if (info.changes > 0) {
      Logger.warn('NodeRegistry', `Marked ${info.changes} node(s) as OFFLINE due to timeout`);
    }
  }

  public static startMonitoring() {
    Logger.info('NodeRegistry', 'Started mesh network vital monitoring');
    setInterval(() => {
      this.checkStaleNodes();
      // Keep server itself ONLINE
      this.heartbeat('SERVER_LOCAL');
    }, 30000);
  }
}
