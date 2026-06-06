import { useConfigStore } from '../store/configStore';
import { Logger } from '../utils/logger';

export class WSClient {
  private ws: WebSocket | null = null;
  private path: string;
  private onMessage: (data: any) => void;
  private onClose: () => void;
  private isConnected = false;

  constructor(path: string, onMessage: (data: any) => void, onClose: () => void) {
    this.path = path; // e.g. '/ws/chat' or '/ws/status'
    this.onMessage = onMessage;
    this.onClose = onClose;
  }

  connect() {
    if (this.ws) {
      this.disconnect();
    }

    const state = useConfigStore.getState();
    const config = state.config;

    if (!config?.server?.url) {
      Logger.warn('WSClient', `Unable to connect WS to ${this.path}: Server URL not configured`);
      return;
    }

    // Transform http(s):// into ws(s)://
    let wsUrl = config.server.url.replace(/^http/, 'ws').replace(/\/$/, '');
    wsUrl += this.path;
    
    // We pass the API key via query param, since browser WebSockets do not support custom headers easily.
    // The OCI Fastify server can read the auth_token from the query url. 
    // According to specs, the X-API-Key header is for REST, here we use the query string as a common practice.
    wsUrl += `?token=${encodeURIComponent(config.server.api_key)}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      Logger.info('WSClient', `Neural link established to ${this.path}`);
      this.isConnected = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        Logger.debug('WSClient', `[${this.path}] Inbound frame`, data);
        this.onMessage(data);
      } catch (e) {
        Logger.error('WSClient', `[${this.path}] Synaptic parse error`, e);
      }
    };

    this.ws.onclose = () => {
      Logger.info('WSClient', `Neural link terminated for ${this.path}`);
      this.isConnected = false;
      this.ws = null;
      this.onClose();
    };

    this.ws.onerror = (e) => {
      Logger.error('WSClient', `Hardware failure on ${this.path}`, e);
    };
  }

  send(data: object) {
    if (!this.isConnected || !this.ws) {
      Logger.warn('WSClient', `[${this.path}] Link inactive, cannot transmit packet.`);
      return;
    }
    Logger.debug('WSClient', `[${this.path}] Outbound frame`, data);
    this.ws.send(JSON.stringify(data));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
