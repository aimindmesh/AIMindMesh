import { Logger } from '../utils/Logger';
import { config } from '../config';

export interface OpenClawHealthState {
  isHealthy: boolean;
  statusMessage: string;
  lastCheck: number;
}

export class OpenClawHealthService {
  private static state: OpenClawHealthState = {
    isHealthy: true,
    statusMessage: 'Operational',
    lastCheck: 0
  };

  public static getState(): OpenClawHealthState {
    return { ...this.state };
  }

  private static getAgentKey(): string | undefined {
    return process.env.GOOGLE_API_KEY;
  }

  public static init() {
    Logger.info('OpenClawHealth', 'Initializing periodic health monitor...');
    this.checkHealth(); // Initial check
    setInterval(() => {
      this.checkHealth();
    }, 900000); // Every 15 minutes
  }

  public static async checkHealth() {
    const apiKey = this.getAgentKey();
    if (!apiKey) {
      Logger.warn('OpenClawHealth', 'No GOOGLE_API_KEY found for agent monitoring');
      return;
    }

    try {
      const t0 = Date.now();
      // Use the standard model defined for OpenClaw/Gemini tasks
      const model = config.gemini?.model || 'gemini-3.1-flash-lite-preview';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'health check' }] }] }),
      });
      const duration = Date.now() - t0;

      if (!res.ok) {
        this.state.isHealthy = false;
        if (res.status === 429) this.state.statusMessage = 'Quota Exceeded (429)';
        else if (res.status === 503) this.state.statusMessage = 'Gemini Congestion (503)';
        else this.state.statusMessage = `Service Error: ${res.status}`;
      } else if (duration > 10000) {
        this.state.isHealthy = false;
        this.state.statusMessage = 'Agent API Congestion (High Latency)';
      } else {
        this.state.isHealthy = true;
        this.state.statusMessage = 'Operational';
      }
    } catch (err: any) {
      this.state.isHealthy = false;
      this.state.statusMessage = `Check Failed: ${err.message}`;
    } finally {
      this.state.lastCheck = Date.now();
      Logger.info('OpenClawHealth', `Health check completed. Healthy: ${this.state.isHealthy}, Status: ${this.state.statusMessage}`);
    }
  }

  public static async validateExecution(): Promise<void> {
    // Refresh if older than 5 minutes
    if (Date.now() - this.state.lastCheck > 300000) {
      await this.checkHealth();
    }

    if (!this.state.isHealthy) {
      throw new Error(`Agent execution blocked: ${this.state.statusMessage}`);
    }
  }

  public static markFailure(error: string) {
    this.state.isHealthy = false;
    this.state.statusMessage = error;
    this.state.lastCheck = Date.now();
    Logger.warn('OpenClawHealth', `Agent health marked as FAILED: ${error}`);
  }
}
