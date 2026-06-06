import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { NodeRegistry } from './NodeRegistry';
import { sendToDevice } from './FCMDispatcher';
import { config } from '../config';
import cron, { ScheduledTask } from 'node-cron';
import { FeedManager } from './FeedManager';

export type DeliveryMode = 'PUSH' | 'CONTEXTUAL';

export interface PendingItem {
  id: string;
  insightId: string;
  deviceId: string;
  createdAt: number;
}

export class DeliveryScheduler {

  private static fallbackTask: ScheduledTask | null = null;

  /**
   * Starts the fallback cron job to deliver insights
   * that have remained pending for too long (only in CONTEXTUAL mode).
   */
  public static start(): void {
    this.stop();
    const hours = config.delivery?.fallbackAfterHours ?? 6;
    const expr = `0 */${hours} * * *`;
    this.fallbackTask = cron.schedule(expr, () => this.runFallbackCycle());
    Logger.info('DeliveryScheduler', `Fallback cycle every ${hours}h: ${expr}`);
  }

  public static stop(): void {
    if (this.fallbackTask) {
      this.fallbackTask.stop();
      this.fallbackTask = null;
    }
  }

  public static async deliver(
    insightId: string,
    title: string,
    body: string,
    type: 'INSIGHT' | 'SYSTEM' | 'NOTIFICATION' = 'SYSTEM'
  ): Promise<void> {
    // Ensure the item exists in feed_items to satisfy FK constraints in pending_delivery
    FeedManager.addItem({
      id: insightId,
      type,
      content: `${title}: ${body}`
    });

    const nodes = NodeRegistry.getNodes().filter(n => n.type === 'mobile' && n.fcm_token);

    for (const node of nodes) {
      const mode = this.getModeForDevice(node.id);
      const isQuiet = this.isQuietHour();

      if (mode === 'PUSH' && !isQuiet) {
        // ── Standard PUSH delivery ───────────────────────────────────────
        if (node.fcm_token) {
          sendToDevice(node.fcm_token, {
            title,
            body: body.substring(0, 100) + '...',
            data: { insightId, type: 'INSIGHT_DELIVERY' }
          });
          Logger.debug('DeliveryScheduler', `[PUSH] insight ${insightId} → device ${node.id}`);
        }
      } else {
        // ── Contextual or Quiet Hour: enqueue for later ──────────────────
        this.enqueue(insightId, node.id);
        if (isQuiet && mode === 'PUSH') {
           Logger.info('DeliveryScheduler', `[QUIET] insight ${insightId} enqueued (PUSH suppressed) for ${node.id}`);
        } else {
           Logger.debug('DeliveryScheduler', `[CONTEXTUAL] insight ${insightId} enqueued for ${node.id}`);
        }
      }
    }
  }

  public static isQuietHour(): boolean {
    if (!config.delivery?.quietHours) return false;

    const now = new Date();
    const currentHour = now.getHours();

    const startHour = parseInt(config.delivery.quietStart.split(':')[0]);
    const endHour = parseInt(config.delivery.quietEnd.split(':')[0]);

    if (startHour > endHour) {
      return currentHour >= startHour || currentHour < endHour;
    } else {
      return currentHour >= startHour && currentHour < endHour;
    }
  }

  /**
   * Returns queued insights for a specific device.
   */
  public static getPendingForDevice(deviceId: string): PendingItem[] {
    return db.prepare(`
      SELECT id, insight_id as insightId, device_id as deviceId, created_at as createdAt
      FROM pending_delivery
      WHERE device_id = ? AND status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 20
    `).all(deviceId) as PendingItem[];
  }

  /**
   * Marks one or more items as delivered.
   */
  public static markDelivered(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(`
      UPDATE pending_delivery
      SET status = 'DELIVERED', delivered_at = ?
      WHERE id IN (${placeholders})
    `).run(Date.now(), ...ids);
  }

  /**
   * Reads the saved delivery mode for a device.
   */
  public static getModeForDevice(deviceId: string): DeliveryMode {
    const row = db.prepare(`
      SELECT delivery_mode FROM node_settings WHERE node_id = ?
    `).get(deviceId) as { delivery_mode: string } | undefined;

    return (row?.delivery_mode as DeliveryMode) ?? 'PUSH';
  }

  /**
   * Updates the delivery mode for a device.
   */
  public static setModeForDevice(deviceId: string, mode: DeliveryMode): void {
    db.prepare(`
      INSERT INTO node_settings (node_id, delivery_mode)
      VALUES (?, ?)
      ON CONFLICT(node_id) DO UPDATE SET delivery_mode = excluded.delivery_mode
    `).run(deviceId, mode);

    Logger.info('DeliveryScheduler', `Device ${deviceId} → mode: ${mode}`);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private static enqueue(insightId: string, deviceId: string): void {
    // Avoid duplicates: do not enqueue if already pending for the same device
    const existing = db.prepare(`
      SELECT id FROM pending_delivery
      WHERE insight_id = ? AND device_id = ? AND status = 'PENDING'
    `).get(insightId, deviceId);

    if (existing) return;

    db.prepare(`
      INSERT INTO pending_delivery (id, insight_id, device_id, created_at, status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `).run(crypto.randomUUID(), insightId, deviceId, Date.now());
  }

  /**
   * Fallback: sends FCM push for insights that remained pending for more than N hours.
   */
  private static runFallbackCycle(): void {
    const hours = config.delivery?.fallbackAfterHours ?? 6;
    const threshold = Date.now() - hours * 60 * 60 * 1000;

    const stale = db.prepare(`
      SELECT pd.id, pd.insight_id as insightId, pd.device_id as deviceId,
             fi.content, n.fcm_token
      FROM pending_delivery pd
      JOIN feed_items fi ON fi.id = pd.insight_id
      JOIN nodes n ON n.id = pd.device_id
      WHERE pd.status = 'PENDING' AND pd.created_at < ?
    `).all(threshold) as any[];

    for (const item of stale) {
      if (!item.fcm_token) continue;

      sendToDevice(item.fcm_token, {
        title: '💡 Pending insight',
        body: item.content.substring(0, 100) + '...',
        data: { insightId: item.insightId, type: 'INSIGHT_FALLBACK' }
      });

      db.prepare(`
        UPDATE pending_delivery SET status = 'DELIVERED', delivered_at = ? WHERE id = ?
      `).run(Date.now(), item.id);

      Logger.info('DeliveryScheduler', `Fallback FCM sent for insight ${item.insightId} → ${item.deviceId}`);
    }
  }
}
