import { randomUUID } from 'crypto';
import db from '../../db/sqlite';

export class OrganizationAuditService {
  async log(event: {
    eventType: string;
    actorType: 'human' | 'role' | 'system';
    actorId: string;
    targetType: string;
    targetId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const now = new Date().toISOString();
    const id = randomUUID();

    try {
      db.prepare(`
        INSERT INTO organization_audit_log (
          id, event_type, actor_type, actor_id, target_type, target_id, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        event.eventType,
        event.actorType,
        event.actorId,
        event.targetType,
        event.targetId,
        JSON.stringify(event.payload),
        now
      );
    } catch (e) {
      console.error('Failed to write audit log to SQLite:', e);
    }
  }
}
