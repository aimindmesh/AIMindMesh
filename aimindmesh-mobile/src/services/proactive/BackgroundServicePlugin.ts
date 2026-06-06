
import { logger } from '../logger';

export class BackgroundServicePlugin {
    private listeners: ((timestamp: number) => void)[] = [];

    constructor() {
        this.init();
    }

    private init() {
        if (typeof window !== 'undefined') {
            window.addEventListener('proactiveCheck', (event: any) => {
                const timestamp = event.detail?.timestamp || Date.now();
                logger.log('info', `[BackgroundServicePlugin] Received proactive check at ${timestamp}`);
                this.notifyListeners(timestamp);
            });
        }
    }

    addListener(callback: (timestamp: number) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notifyListeners(timestamp: number) {
        this.listeners.forEach(cb => cb(timestamp));
    }
}

export const backgroundServicePlugin = new BackgroundServicePlugin();
