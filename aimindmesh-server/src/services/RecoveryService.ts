import { getSession } from '../db/neo4j';
import { KnowledgeService } from './KnowledgeService';
import { Logger } from '../utils/Logger';

export class RecoveryService {
  private static isRunning = false;
  private static totalProcessed = 0;
  private static BATCH_SIZE = 50;

  /**
   * Starts the background enrichment recovery process.
   * This process identifies concepts that were extracted but not enriched,
   * and systematically processes them using Search + LLM.
   */
  public static async start(): Promise<void> {
    if (this.isRunning) {
      Logger.warn('RecoveryService', 'Recovery process is already running.');
      return;
    }

    this.isRunning = true;
    Logger.info('RecoveryService', 'Persistent Enrichment Recovery Engine started in background.');

    // Run the loop in background (non-blocking)
    void this.recoveryLoop();
  }

  private static async recoveryLoop() {
    while (this.isRunning) {
      const session = getSession();
      try {
        // Find concepts that need enrichment:
        // - Generic descriptions ("Extracted from...")
        // - enriched property is false or missing
        // - description is too short (< 200 chars)
        const result = await session.run(`
          MATCH (c:Concept) 
          WHERE (c.description STARTS WITH "Extracted from" OR c.enriched IS NULL OR c.enriched = false)
            AND (size(c.description) < 200)
            AND (size(c.name) > 2)
            AND (NOT c.name CONTAINS "(?:)")
          RETURN c.id as id, c.name as name
          ORDER BY c.updatedAt DESC
          LIMIT toInteger($limit)
        `, { limit: this.BATCH_SIZE });

        const records = result.records.map(r => ({ id: r.get('id'), name: r.get('name') }));
        
        if (records.length === 0) {
          Logger.info('RecoveryService', 'No more concepts needing enrichment. Sleeping for 1 hour.');
          await new Promise(resolve => setTimeout(resolve, 3600000)); // Check again in 1 hour
          continue;
        }

        Logger.info('RecoveryService', `Starting background batch of ${records.length} concepts...`);

        for (const record of records) {
          if (!this.isRunning) break;
          
          this.totalProcessed++;
          Logger.info('RecoveryService', `[${this.totalProcessed}] Background Enrichment: ${record.name}`);
          
          try {
            await KnowledgeService.enrichConcept(record.id);
          } catch (e: any) {
            Logger.error('RecoveryService', `Failed to enrich ${record.name}: ${e.message}`);
          }

          // Slow and steady delay (2 seconds between items)
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        Logger.info('RecoveryService', `Batch complete. Total background arricchimenti: ${this.totalProcessed}`);
        
        // Wait 30 seconds between batches to avoid overloading the local node
        await new Promise(resolve => setTimeout(resolve, 30000));

      } catch (err: any) {
        Logger.error('RecoveryService', `Loop error: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait before retry
      } finally {
        await session.close();
      }
    }
  }

  public static stop() {
    this.isRunning = false;
    Logger.info('RecoveryService', 'Recovery engine stopping...');
  }
}
