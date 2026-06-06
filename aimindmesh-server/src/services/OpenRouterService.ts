import { config } from '../config';
import { Logger } from '../utils/Logger';
import * as FCMDispatcher from './FCMDispatcher';
import db from '../db/sqlite';

export interface OpenRouterCredits {
  total_credits: number;
  total_usage: number;
  balance: number;
  lastChecked: number;
}

export class OpenRouterService {
  private static lastCredits: OpenRouterCredits | null = null;
  private static monitorInterval: NodeJS.Timeout | null = null;

  public static async init() {
    // Load last known credits from DB if available (optional)
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE id = ?').get('openrouter_credits') as any;
      if (row) {
        this.lastCredits = JSON.parse(row.value);
      }
    } catch (e) {
      Logger.error('OpenRouterService', 'Failed to load credits from DB', e);
    }

    this.startMonitoring();
  }

  public static startMonitoring() {
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    
    // Initial check
    void this.checkCredits();

    const hours = config.openrouter?.creditCheckIntervalHours || 1;
    this.monitorInterval = setInterval(() => {
      void this.checkCredits();
    }, hours * 60 * 60 * 1000);

    Logger.info('OpenRouterService', `Monitoring started every ${hours}h`);
  }

  public static async checkCredits(): Promise<OpenRouterCredits | null> {
    if (!config.openrouter?.apiKey || config.openrouter.apiKey.includes('...')) {
      Logger.warn('OpenRouterService', 'OpenRouter API Key missing or placeholder. Skipping check.');
      return null;
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: {
          'Authorization': `Bearer ${config.openrouter.apiKey}`
        }
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`);
      }

      const json = await res.json() as any;
      const data = json.data;
      
      const credits: OpenRouterCredits = {
        total_credits: data.total_credits,
        total_usage: data.total_usage,
        balance: data.total_credits - data.total_usage,
        lastChecked: Date.now()
      };

      this.lastCredits = credits;

      // Persist to DB
      db.prepare('INSERT OR REPLACE INTO system_settings (id, value, updated_at) VALUES (?, ?, ?)')
        .run('openrouter_credits', JSON.stringify(credits), Date.now());

      Logger.info('OpenRouterService', `Credits checked: $${credits.balance.toFixed(4)} available.`);

      // Check threshold
      const threshold = config.openrouter.lowCreditThreshold || 5.0;
      if (credits.balance < threshold) {
        Logger.warn('OpenRouterService', `Low credit warning! $${credits.balance.toFixed(2)} remaining.`);
        await FCMDispatcher.sendMulticast(
          'OpenRouter Low Credits',
          `Attention: Your OpenRouter balance is $${credits.balance.toFixed(2)}. Please recharge soon.`,
          { type: 'SYSTEM_ALERT', category: 'BILLING' }
        );
      }

      return credits;
    } catch (e: any) {
      Logger.error('OpenRouterService', 'Failed to check OpenRouter credits', e);
      return null;
    }
  }

  public static getCredits(): OpenRouterCredits | null {
    return this.lastCredits;
  }
}
