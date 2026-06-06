import { config } from '../config';
import { Logger } from '../utils/Logger';
import { InferenceProviders } from './InferenceProviders';
import db from '../db/sqlite';
import crypto from 'crypto';

export class GeminiQueueManager {
  private static rpmTimestamps: Map<string, number[]> = new Map();
  private static dailyTimestamps: Map<string, number[]> = new Map();
  private static pendingQueue: Array<{ 
    resolve: (v: string) => void, 
    reject: (r: any) => void, 
    prompt: string, 
    signal?: AbortSignal, 
    model?: string,
    apiKey?: string
  }> = [];
  private static isProcessing = false;

  private static getHash(key?: string): string {
    if (!key) return 'default';
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  public static async init(): Promise<void> {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recentCalls = db.prepare('SELECT timestamp, api_key_hash FROM gemini_calls WHERE timestamp > ? ORDER BY timestamp ASC').all(oneDayAgo) as any[];
    
    this.dailyTimestamps.clear();
    for (const call of recentCalls) {
      const hash = call.api_key_hash || 'default';
      if (!this.dailyTimestamps.has(hash)) this.dailyTimestamps.set(hash, []);
      this.dailyTimestamps.get(hash)!.push(call.timestamp);
    }
    
    Logger.info('GeminiQueueManager', `Initialized with ${recentCalls.length} recent calls across ${this.dailyTimestamps.size} keys.`);
  }

  public static enqueue(prompt: string, signal?: AbortSignal, model?: string, apiKey?: string): Promise<string> {
    return new Promise((res, rej) => {
      this.pendingQueue.push({ resolve: res, reject: rej, prompt, signal, model, apiKey });
      void this.drain();
    });
  }

  public static trackCall(apiKey?: string): void {
    const now = Date.now();
    const hash = this.getHash(apiKey);
    db.prepare('INSERT INTO gemini_calls (timestamp, api_key_hash) VALUES (?, ?)').run(now, hash);
    
    if (!this.dailyTimestamps.has(hash)) this.dailyTimestamps.set(hash, []);
    this.dailyTimestamps.get(hash)!.push(now);
    this.pruneOld(hash);
  }

  private static pruneOld(hash: string): void {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const timestamps = this.dailyTimestamps.get(hash);
    if (!timestamps) return;
    
    while (timestamps.length > 0 && timestamps[0] < oneDayAgo) {
      timestamps.shift();
    }
  }

  /**
   * Checks if there's enough capacity for an estimated number of calls on a specific key.
   */
  public static hasCapacity(weight: number = 1, apiKey?: string): boolean {
    const hash = this.getHash(apiKey);
    this.pruneOld(hash);
    
    const timestamps = this.dailyTimestamps.get(hash) || [];
    const limit = config.gemini?.dailyQuotaCap ?? 500;
    // Allow 90% utilization before throttling complex agentic tasks
    const safetyLimit = limit * 0.9;
    return (timestamps.length + weight) <= safetyLimit;
  }

  /**
   * Reserves capacity for external calls (like OpenClaw).
   */
  public static reserveCapacity(weight: number, apiKey?: string): void {
    const now = Date.now();
    const hash = this.getHash(apiKey);
    for (let i = 0; i < weight; i++) {
      db.prepare('INSERT INTO gemini_calls (timestamp, api_key_hash) VALUES (?, ?)').run(now, hash);
      if (!this.dailyTimestamps.has(hash)) this.dailyTimestamps.set(hash, []);
      this.dailyTimestamps.get(hash)!.push(now);
    }
    Logger.info('GeminiQueueManager', `Reserved ${weight} calls for agentic task on [${hash}]. Total usage: ${this.dailyTimestamps.get(hash)?.length}`);
  }

  private static async drain(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.pendingQueue.length > 0) {
        const item = this.pendingQueue[0];
        const now = Date.now();
        const hash = this.getHash(item.apiKey);
        
        // RPM Check
        if (!this.rpmTimestamps.has(hash)) this.rpmTimestamps.set(hash, []);
        const rpm = this.rpmTimestamps.get(hash)!;
        
        const filteredRpm = rpm.filter(t => now - t < 60000);
        this.rpmTimestamps.set(hash, filteredRpm);
        
        if (filteredRpm.length >= (config.gemini?.rpmLimit ?? 15)) {
          // If the head of the queue is throttled, we wait and try again (don't shift)
          await new Promise(r => setTimeout(r, 1000));
          // Optimization: if we have other items in queue with different keys, we could process them, 
          // but for simplicity we maintain strict FIFO for now.
          continue;
        }

        // Daily Check
        this.pruneOld(hash);
        const daily = this.dailyTimestamps.get(hash) || [];
        if (daily.length >= (config.gemini?.dailyQuotaCap ?? 500)) {
          Logger.warn('GeminiQueueManager', `Daily rolling quota reached for key [${hash}] (${daily.length}). Throwing quota error.`);
          this.pendingQueue.shift();
          item.reject(new Error('GEMINI_DAILY_QUOTA_REACHED'));
          continue;
        }

        // All checks passed for this item
        this.pendingQueue.shift();
        rpm.push(Date.now());
        InferenceProviders.callGemini(item.prompt, item.signal, item.model, item.apiKey)
          .then(item.resolve)
          .catch(item.reject);
      }
    } finally { this.isProcessing = false; }
  }
}
