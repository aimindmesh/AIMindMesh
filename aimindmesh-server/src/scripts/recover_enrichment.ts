import { getSession, initNeo4j } from '../db/neo4j';
import { KnowledgeService } from '../services/KnowledgeService';
import { Logger } from '../utils/Logger';

async function recover() {
  Logger.info('Recovery', 'Enrichment Recovery Daemon started.');
  await initNeo4j();

  let totalProcessed = 0;
  const BATCH_SIZE = 50;

  while (true) {
    const session = getSession();
    try {
      const result = await session.run(`
        MATCH (c:Concept) 
        WHERE (c.description STARTS WITH "Extracted from" OR c.enriched IS NULL OR c.enriched = false)
          AND (size(c.description) < 200)
        RETURN c.id as id, c.name as name
        ORDER BY c.updatedAt DESC
        LIMIT toInteger($limit)
      `, { limit: BATCH_SIZE });

      const records = result.records.map(r => ({ id: r.get('id'), name: r.get('name') }));
      
      if (records.length === 0) {
        Logger.info('Recovery', 'No more concepts needing enrichment. Exiting.');
        break;
      }

      Logger.info('Recovery', `Starting batch of ${records.length} concepts...`);

      for (const record of records) {
        totalProcessed++;
        Logger.info('Recovery', `[${totalProcessed}] Enriching: ${record.name} (${record.id})`);
        
        try {
          await KnowledgeService.enrichConcept(record.id);
        } catch (e: any) {
          Logger.error('Recovery', `Failed to enrich ${record.name}: ${e.message}`);
        }

        // Delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      Logger.info('Recovery', `Batch complete. Total processed so far: ${totalProcessed}`);
      
      // Short rest between batches
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (err: any) {
      Logger.error('Recovery', `Fatal error in recovery loop: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait before retry
    } finally {
      await session.close();
    }
  }
}

recover().catch(err => {
  console.error('Fatal error in recovery script:', err);
  process.exit(1);
});
