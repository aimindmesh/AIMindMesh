import { Logger } from '../utils/Logger';

export interface ConnectedClient {
    id: string;
    send: (message: string) => void;
}

export class NotificationService {
    private static clients = new Map<string, ConnectedClient>();

    public static registerClient(id: string, sendFn: (message: string) => void) {
        this.clients.set(id, { id, send: sendFn });
        Logger.debug('NotificationService', `Client ${id} registered for live updates. Total: ${this.clients.size}`);
    }

    public static unregisterClient(id: string) {
        this.clients.delete(id);
        Logger.debug('NotificationService', `Client ${id} unregistered. Total: ${this.clients.size}`);
    }

    public static broadcast(type: string, data: any) {
        const message = JSON.stringify({ type, data, timestamp: Date.now() });
        let successCount = 0;

        for (const client of this.clients.values()) {
            try {
                client.send(message);
                successCount++;
            } catch (err) {
                Logger.warn('NotificationService', `Failed to send broadcast to client ${client.id}`);
            }
        }

        if (successCount > 0) {
            Logger.info('NotificationService', `Broadcasted [${type}] to ${successCount} clients`);
        }
    }
}
