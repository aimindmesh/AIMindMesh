import { KGManager } from './KGManager';
import { SearchService } from './SearchService';
import { InferenceRouter } from './InferenceRouter';
import { Logger } from '../utils/Logger';
import { config } from '../config';
import pLimit from 'p-limit';

export class KnowledgeService {
  private static enrichmentLimit = pLimit(1); // Only 1 concurrent enrichment

  /**
   * Enriches a concept's description using web search results.
   * Useful for concepts extracted from documents that lack context.
   */
  public static async enrichConcept(conceptId: string): Promise<void> {
    if (!config.search?.enabled) {
      Logger.debug('KnowledgeService', 'Search disabled, skipping enrichment.');
      return;
    }

    return this.enrichmentLimit(async () => {
      try {
        // 1. Get concept details
      const concept = await KGManager.getNodeById(conceptId);
      if (!concept) {
        Logger.warn('KnowledgeService', `Concept not found for enrichment: ${conceptId}`);
        return;
      }

      // Skip if it already has a long description (unless forced)
      if (concept.description && concept.description.length > 200) {
        Logger.debug('KnowledgeService', `Concept "${concept.name}" already has a substantial description. Skipping.`);
        return;
      }

      Logger.info('KnowledgeService', `Enriching concept: ${concept.name}`);
      
      // 2. Perform web search
      const results = await SearchService.search(concept.name, { deep: false });
      if (results.length === 0) {
        Logger.info('KnowledgeService', `No search results for "${concept.name}".`);
        return;
      }

      // 3. Generate enriched description
      const context = SearchService.formatResultsForContext(results);
      const prompt = `You are a knowledge architect. Based on the web search results below, write a comprehensive, technical, and precise description for the concept "${concept.name}".
      
SEARCH RESULTS:
${context}

RULES:
- Be objective and factual.
- Use 3-5 sentences.
- If the concept is ambiguous, describe the most likely intended meaning in a technical/AI context.
- Return ONLY the description text. No preamble.

DESCRIPTION:`;

      const description = await InferenceRouter.complete(prompt, 'CONCEPT_ENRICHMENT', { taskName: `Enrich Concept: ${concept.name}` });
      
      if (description && description.length > 20) {
        // 4. Update concept with new description and new embedding
        const embedding = await InferenceRouter.getEmbeddings(description);
        await KGManager.upsertConcept(concept.name, description.trim(), embedding, true);
        Logger.info('KnowledgeService', `Concept "${concept.name}" enriched successfully.`);
      } else {
        Logger.warn('KnowledgeService', `LLM returned empty or too short description for "${concept.name}".`);
      }
      } catch (err: any) {
        Logger.error('KnowledgeService', `Failed to enrich concept ${conceptId}: ${err.message}`);
      }
    });
  }
}
