import db from '../db/sqlite';
import crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { NodeRegistry } from './NodeRegistry';
import { sendToDevice } from './FCMDispatcher';
import { config } from '../config';
import cron, { ScheduledTask } from 'node-cron';
import { FeedManager } from './FeedManager';
import { hourIn, isWithinQuietHours, normalizeDeviceId } from '../utils/quietHours';

export type DeliveryMode = 'PUSH' | 'CONTEXTUAL';

/** Delivery preferences a device sent (PUT /api/delivery/settings) */
export interface DeviceDeliverySettings {
  mode: DeliveryMode;
  /** Null: the device never sent its quiet hours (the server-wide ones apply) */
  quietHours: { enabled: boolean; start: string; end: string } | null;
  timezone: string | null;
}

export interface DeviceDeliveryUpdate {
  mode?: DeliveryMode;
  quietHours?: { enabled: boolean; start: string; end: string };
  timezone?: string;
}

export interface PendingItem {
  id: string;
  insightId: string;
  deviceId: string;
  createdAt: number;
  /** Text of the insight (null if it was deleted meanwhile) */
  content: string | null;
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
    this.fallbackTask = cron.schedule(expr, () => this.runFallbackCycle(), { timezone: config.proactive?.timezone });
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
      const isQuiet = this.isQuietHour(node.id);

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

  /**
   * Quiet hours of a device, in its own time zone (the container runs in UTC). A device that
   * never sent its quiet hours follows the server-wide ones, in the configured time zone.
   */
  public static isQuietHour(deviceId?: string, now: Date = new Date()): boolean {
    const device = deviceId ? this.getDeviceSettings(deviceId) : null;
    if (device?.quietHours) {
      return device.quietHours.enabled
        && isWithinQuietHours(hourIn(now, device.timezone ?? config.proactive?.timezone), device.quietHours.start, device.quietHours.end);
    }
    if (!config.delivery?.quietHours) return false;
    return isWithinQuietHours(hourIn(now, config.proactive?.timezone), config.delivery.quietStart, config.delivery.quietEnd);
  }

  /**
   * Returns queued insights for a specific device.
   */
  public static getPendingForDevice(rawDeviceId: string): PendingItem[] {
    const deviceId = normalizeDeviceId(rawDeviceId);
    // content: the insight text, shown by the device notification (null if the item was deleted)
    return db.prepare(`
      SELECT pd.id, pd.insight_id as insightId, pd.device_id as deviceId, pd.created_at as createdAt, f.content
      FROM pending_delivery pd
      LEFT JOIN feed_items f ON f.id = pd.insight_id
      WHERE pd.device_id = ? AND pd.status = 'PENDING'
      ORDER BY pd.created_at ASC
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
    return this.getDeviceSettings(deviceId)?.mode ?? 'PUSH';
  }

  /** What the device sent, or null when it never did. */
  public static getDeviceSettings(rawDeviceId: string): DeviceDeliverySettings | null {
    const row = db.prepare(`
      SELECT delivery_mode, quiet_enabled, quiet_start, quiet_end, timezone FROM node_settings WHERE node_id = ?
    `).get(normalizeDeviceId(rawDeviceId)) as {
      delivery_mode: string; quiet_enabled: number | null; quiet_start: string | null; quiet_end: string | null; timezone: string | null;
    } | undefined;
    if (!row) return null;
    return {
      mode: row.delivery_mode === 'CONTEXTUAL' ? 'CONTEXTUAL' : 'PUSH',
      quietHours: row.quiet_enabled === null || !row.quiet_start || !row.quiet_end
        ? null
        : { enabled: row.quiet_enabled === 1, start: row.quiet_start, end: row.quiet_end },
      timezone: row.timezone,
    };
  }

  /**
   * Updates the delivery mode for a device.
   */
  public static setModeForDevice(deviceId: string, mode: DeliveryMode): void {
    this.updateDeviceSettings(deviceId, { mode });
  }

  /** Partial update: fields not given keep their value. */
  public static updateDeviceSettings(rawDeviceId: string, update: DeviceDeliveryUpdate): void {
    const deviceId = normalizeDeviceId(rawDeviceId);
    db.prepare(`
      INSERT INTO node_settings (node_id, delivery_mode, quiet_enabled, quiet_start, quiet_end, timezone)
      VALUES (@id, COALESCE(@mode, 'PUSH'), @quietEnabled, @quietStart, @quietEnd, @timezone)
      ON CONFLICT(node_id) DO UPDATE SET
        delivery_mode = COALESCE(@mode, delivery_mode),
        quiet_enabled = COALESCE(@quietEnabled, quiet_enabled),
        quiet_start   = COALESCE(@quietStart, quiet_start),
        quiet_end     = COALESCE(@quietEnd, quiet_end),
        timezone      = COALESCE(@timezone, timezone)
    `).run({
      id: deviceId,
      mode: update.mode ?? null,
      quietEnabled: update.quietHours ? (update.quietHours.enabled ? 1 : 0) : null,
      quietStart: update.quietHours?.start ?? null,
      quietEnd: update.quietHours?.end ?? null,
      timezone: update.timezone ?? null,
    });

    Logger.info('DeliveryScheduler', `Device ${deviceId} → ${JSON.stringify(update)}`);
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
      JOIN nodes n ON UPPER(n.id) = pd.device_id
      WHERE pd.status = 'PENDING' AND pd.created_at < ?
    `).all(threshold) as any[];

    for (const item of stale) {
      if (!item.fcm_token) continue;
      // Still quiet for this device: the next cycle delivers it
      if (this.isQuietHour(item.deviceId)) continue;

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
