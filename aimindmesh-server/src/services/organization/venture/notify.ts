import { config } from '../../../config';
import { Logger } from '../../../utils/Logger';
import * as FCMDispatcher from '../../FCMDispatcher';
import { NotificationService } from '../../NotificationService';

/**
 * Tells the owner about a venture event: a WebSocket broadcast for open clients and, when
 * `push` is given, a push notification that opens the Organization view.
 */
export async function notifyOwner(
  event: string,
  data: Record<string, unknown>,
  push?: { title: string; body: string; tab?: 'ideas' | 'repos' },
): Promise<void> {
  NotificationService.broadcast(event, data);
  if (!push) return;
  await FCMDispatcher.sendToDevice(config.fcm?.testToken || '', {
    title: push.title,
    body: push.body,
    data: { type: 'VENTURE_IDEAS', screen: 'OrganizationView', tab: push.tab ?? 'ideas' },
  }).catch((e: any) => Logger.warn('VentureNotify', `Push "${push.title}" failed: ${e.message}`));
}
