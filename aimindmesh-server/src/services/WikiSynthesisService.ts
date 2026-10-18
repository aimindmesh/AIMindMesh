/**
 * WikiSynthesisService.ts
 * The "Brain" that compiles the Neural Wiki.
 * Runs on a configurable cron schedule (default: every 24h, offset +30min
 * from ProactiveEngine to avoid LLM contention).
 *
 * Uses the InferenceRouter with type 'WIKI_SYNTHESIS' so it always routes to
 * the model configured as preferred by the user (routing.preferredNode).
 */

import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { KGManager } from './KGManager';
import { InferenceRouter, type TaskPayload } from './InferenceRouter';
import { WikiManager, WikiPage } from './WikiManager';
import { Logger } from '../utils/Logger';
import { SearchService } from './SearchService';
import { InferenceRegistry } from './InferenceRegistry';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function buildSynthesisPrompt(
  concept: { id: string; name: string; description: string },
  neighbors: { nodes: any[]; links: any[] },
  insights: { id: string; content: string }[],
  searchContext?: string
): string {
  const neighborNames = neighbors.nodes
    .filter(n => n.id !== concept.id && n.name)
    .slice(0, 10)
    .map(n => `- [[${n.name}]]${n.description ? `: ${n.description.slice(0, 80)}` : ''}`)
    .join('\n') || '_No direct connections yet._';

  const insightExcerpts = insights
    .slice(0, 5)
    .map((i, idx) => `${idx + 1}. ${i.content.slice(0, 200)}`)
    .join('\n') || '_No insights derived yet._';

  return `You are a knowledge wiki editor maintaining a personal AI knowledge base.
Write a comprehensive but concise Markdown wiki page for the following concept.

CONCEPT: ${concept.name}
DESCRIPTION: ${concept.description || 'No description available.'}

RELATED CONCEPTS (from knowledge graph):
${neighborNames}

RECENT INSIGHTS DERIVED FROM THIS CONCEPT:
${insightExcerpts}

${searchContext ? `EXTERNAL RESEARCH DATA (from web search):\n${searchContext}\n` : ''}

RULES:
- Start the response with a single '# ' heading that provides a clear, human-readable, and explanatory title for the concept (e.g., instead of "voxtral_context", use "# Voxtral Context Management").
- Write in clear, flowing prose (not just bullet lists)
- Use ## sections: Overview, Key Connections, Open Questions, Related Insights
- Reference related concepts using [[Concept Name]] wikilink syntax EXACTLY as shown above
- If research data is provided, use it to enrich the page. Cite sources using [n].
- Target 300–500 words total
- NEVER fabricate facts not present in the provided context or research data
- Do NOT include frontmatter, code fences, or any other preamble before the title.
- CRITICAL: The entire wiki page MUST be written in English.

Output only the Markdown body.`;
}

function extractTags(neighbors: { nodes: any[] }): string[] {
  // Use the labels of neighboring nodes as tags (max 5)
  const tags = new Set<string>();
  for (const node of neighbors.nodes.slice(0, 10)) {
    if (Array.isArray(node.labels)) {
      node.labels.forEach((l: string) => tags.add(l.toLowerCase()));
    }
  }
  return Array.from(tags).slice(0, 5);
}

// ─── WikiSynthesisService ─────────────────────────────────────────────────────

export class WikiSynthesisService {
  private static isRunning = false;
  private static hasPendingRequest = false;
  private static cronTask: ScheduledTask | null = null;

  /**
   * Start the scheduled synthesis cycle.
   */
  public static start(): void {
    if (!config.wiki?.enabled) return;

    const hours = config.wiki.syncIntervalHours ?? 24;
    const cronExpr = `30 */${hours} * * *`;

    // The scheduled cycle can wait: its pages may go through Claude's half-price batches
    this.cronTask = cron.schedule(cronExpr, () => {
      this.runCycle({ batchable: true }).catch(e =>
        Logger.error('WikiSynthesisService', `Scheduled cycle failed: ${e.message}`)
      );
    }, { timezone: config.proactive.timezone });

    Logger.info('WikiSynthesisService', `Wiki synthesis scheduled: ${cronExpr}`);
    
    InferenceRouter.onTaskCompleted(async (id: string, result: string, metadata: any, type: any) => {
        const info = InferenceRegistry.get(id);
        const taskName = info?.taskName || metadata?.options?.taskName;
        
        if (metadata?.type === 'wiki-synthesis' || metadata?.type === 'wiki-topic-synthesis' || (taskName && taskName.startsWith('Wiki Synthesis: ') || taskName?.startsWith('Wiki Topic: '))) {
            let body = result.trim();
            if (body.length < 50) return;

            let conceptName = metadata?.concept?.name;
            let conceptId = metadata?.concept?.id;
            let tags = metadata?.tags || [];
            const isTopic = metadata?.type === 'wiki-topic-synthesis' || taskName?.startsWith('Wiki Topic: ');

            if (!conceptName && taskName) {
                conceptName = taskName.replace('Wiki Synthesis: ', '').replace('Wiki Topic: ', '');
            }

            if (!conceptName) return;

            // Extract the descriptive # Title
            let extractedTitle = conceptName;
            const titleMatch = body.match(/^#\s+(.+?)(?:\n|$)/);
            if (titleMatch) {
                extractedTitle = titleMatch[1].trim();
                body = body.replace(/^#\s+.+?(?:\n|$)/, '').trim(); // Remove it so the UI doesn't render two H1s
            }

            const slug = toSlug(conceptName);
            const page: WikiPage = {
                slug,
                folder: isTopic ? 'topics' : 'concepts',
                title: extractedTitle,
                body,
                neo4jId: conceptId || 'manual-retry',
                tags: tags,
                updatedAt: new Date().toISOString(),
            };

            await WikiManager.savePage(page);
            await WikiManager.rebuildIndex();
            Logger.info('WikiSynthesisService', `Page saved via async listener: ${slug} [Task: ${id.slice(0,8)}]`);
        }
    });
  }

  public static stop(): void {
    this.cronTask?.stop();
    this.cronTask = null;
  }

  /**
   * Run one full synthesis cycle.
   * Safe to call manually (e.g. from Admin API).
   * Now handles queuing if called while already running.
   */
  public static async runCycle(opts: { batchable?: boolean } = {}): Promise<{ pagesUpdated: number; queued?: boolean }> {
    if (this.isRunning) {
      if (this.hasPendingRequest) {
        Logger.warn('WikiSynthesisService', 'Cycle already running and one already queued — ignoring duplicate trigger');
        return { pagesUpdated: 0, queued: true };
      }
      this.hasPendingRequest = true;
      Logger.info('WikiSynthesisService', 'Cycle already running — request queued for sequential execution');
      return { pagesUpdated: 0, queued: true };
    }

    this.isRunning = true;
    Logger.info('WikiSynthesisService', 'Wiki synthesis cycle started');

    let pagesUpdated = 0;
    try {
      const maxConcepts = config.wiki?.maxConceptsPerCycle ?? 20;

      // 1. Synthesize Concepts
      const session_kg = await this.fetchConceptsForSynthesis(maxConcepts);
      Logger.info('WikiSynthesisService', `Synthesizing ${session_kg.length} concept pages`);

      // Batch mode: prompts are built one at a time (searches stay sequential), then every page
      // is sent at once so they share one Claude batch; the completion listener saves them
      const batchJobs: Array<{ label: string; job: Promise<unknown> }> = [];
      const synthesize = async (label: string, task: TaskPayload | null) => {
        if (!task) return;
        if (!opts.batchable) {
          await InferenceRouter.routeTask(task);
          pagesUpdated++;
          return;
        }
        const job = InferenceRouter.routeTask({ ...task, options: { ...task.options, batchable: true } });
        job.catch(() => undefined); // settled below: never an unhandled rejection meanwhile
        batchJobs.push({ label, job });
      };

      for (const concept of session_kg) {
        try {
          await synthesize(concept.name, await this.buildPageTask(concept));
        } catch (e: any) {
          Logger.warn('WikiSynthesisService', `Failed to synthesize page for "${concept.name}": ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      // 2. Synthesize Topics
      Logger.info('WikiSynthesisService', `Synthesizing topic pages (v2)`);
      const clusters = await KGManager.getThematicClusters(5);
      for (const cluster of clusters) {
        try {
          await synthesize(cluster.name, await this.buildTopicTask(cluster));
        } catch (e: any) {
          Logger.warn('WikiSynthesisService', `Failed to synthesize topic "${cluster.name}": ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      const settled = await Promise.allSettled(batchJobs.map(j => j.job));
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') pagesUpdated++;
        else Logger.warn('WikiSynthesisService', `Failed to synthesize "${batchJobs[i].label}": ${(r.reason as Error)?.message}`);
      });

      await WikiManager.rebuildIndex();
      await WikiManager.appendLog(`wiki-synthesis | ${pagesUpdated} pages updated`);
      await WikiManager.commitChanges(`Wiki sync: ${pagesUpdated} pages updated`);

      Logger.info('WikiSynthesisService', `Cycle complete — ${pagesUpdated} pages updated`);
    } finally {
      this.isRunning = false;
      if (this.hasPendingRequest) {
        this.hasPendingRequest = false;
        Logger.info('WikiSynthesisService', 'Running queued cycle...');
        setImmediate(() => this.runCycle().catch(e => Logger.error('WikiSynthesisService', `Queued cycle failed: ${e.message}`)));
      }
    }

    return { pagesUpdated };
  }

  /**
   * Non-blocking hook called by ProactiveEngine after a new Insight is created.
   * Schedules a background refresh of the two source concept pages.
   */
  public static onNewInsight(
    _insightId: string,
    _insightContent: string,
    sourceConceptIds: string[]
  ): void {
    if (!config.wiki?.enabled) return;

    // Defer to next event loop tick — never block ProactiveEngine
    setImmediate(async () => {
      for (const conceptId of sourceConceptIds) {
        try {
          const concept = await this.fetchConceptById(conceptId);
          if (concept) await this.synthesizePage(concept);
        } catch (e: any) {
          Logger.warn('WikiSynthesisService', `onNewInsight page update failed for ${conceptId}: ${e.message}`);
        }
      }
      if (sourceConceptIds.length > 0) {
        await WikiManager.rebuildIndex().catch(() => null);
      }
    });
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private static async fetchConceptsForSynthesis(
    limit: number
  ): Promise<{ id: string; name: string; description: string }[]> {
    const session = require('../db/neo4j').getSession();
    try {
      // Priority 1: Concepts that have never been synthesized (no updatedAt)
      // Priority 2: Concepts that haven't been updated in 24h
      // Priority 3: Random concepts if nothing else
      const result = await session.run(`
        MATCH (c:Concept)
        WHERE c.updatedAt IS NULL OR timestamp() - c.updatedAt > 86400000
        RETURN c.id as id, c.name as name, c.description as description
        ORDER BY c.updatedAt ASC
        LIMIT toInteger($limit)
      `, { limit });
      
      if (result.records.length > 0) {
        return result.records.map((r: any) => ({
          id: r.get('id'),
          name: r.get('name'),
          description: r.get('description') || ''
        }));
      }

      // Fallback: Just get some random concepts to refresh
      const fallback = await session.run(`
        MATCH (c:Concept)
        WITH c, rand() as r
        ORDER BY r
        RETURN c.id as id, c.name as name, c.description as description
        LIMIT toInteger($limit)
      `, { limit });
      
      return fallback.records.map((r: any) => ({
        id: r.get('id'),
        name: r.get('name'),
        description: r.get('description') || ''
      }));
    } finally {
      await session.close();
    }
  }

  private static async fetchConceptById(
    conceptId: string
  ): Promise<{ id: string; name: string; description: string } | null> {
    const node = await KGManager.getNodeById(conceptId);
    if (!node) return null;
    return { id: node.id, name: node.name ?? conceptId, description: node.description ?? '' };
  }

  private static async synthesizePage(
    concept: { id: string; name: string; description: string }
  ): Promise<void> {
    const task = await this.buildPageTask(concept);
    // NOTE: Page saving is handled by the onTaskCompleted listener in InferenceRouter.
    // This makes the service resilient to restarts and manual task manipulation.
    if (task) await InferenceRouter.routeTask(task);
  }

  /** Inference task of a concept page (context, search and prompt), or null for an unusable name. */
  private static async buildPageTask(
    concept: { id: string; name: string; description: string }
  ): Promise<TaskPayload | null> {
    const slug = toSlug(concept.name);
    if (!slug) {
      Logger.warn('WikiSynthesisService', `Skipping concept with empty slug: "${concept.name}"`);
      return null;
    }

    // 1. Gather context from the knowledge graph
    const [neighbors, insights] = await Promise.all([
      KGManager.getNeighbors(concept.id, 1),
      KGManager.getInsightsForConcept(concept.id, 5),
    ]);

    // 2. SEARCH INTEGRATION
    let searchContext = "";
    if (config.search?.enabled) {
      try {
        const results = await SearchService.search(concept.name);
        if (results.length > 0) {
          searchContext = SearchService.formatResultsForContext(results);
        }
      } catch (err: any) {
        Logger.warn('WikiSynthesisService', `Search failed for "${concept.name}": ${err.message}`);
      }
    }

    // 3. Build prompt and call InferenceRouter using the user's preferred model
    const prompt = buildSynthesisPrompt(concept, neighbors, insights, searchContext);
    return {
      type: 'WIKI_SYNTHESIS',
      prompt,
      tokensEstimate: 700 + (searchContext ? 500 : 0),
      options: { taskName: `Wiki Synthesis: ${concept.name}` },
      metadata: {
          type: 'wiki-synthesis',
          concept: { id: concept.id, name: concept.name },
          tags: extractTags(neighbors)
      }
    };
  }

  /** Inference task of a topic (map of content) page, or null for an unusable name. */
  private static async buildTopicTask(
    cluster: { id: string; name: string; description: string; degree: number }
  ): Promise<TaskPayload | null> {
    const slug = toSlug(cluster.name);
    if (!slug) return null;

    const context = await KGManager.getClusterContext(cluster.id);
    
    const neighborNames = context.neighbors
      .slice(0, 15)
      .map((n: any) => `- [[${n.name}]]${n.description ? `: ${n.description.slice(0, 80)}` : ''}`)
      .join('\n') || '_No connected concepts._';

    const prompt = `You are a knowledge wiki editor. Write a high-level "Topic Summary" (Map of Content) page.
TOPIC: ${cluster.name}
CORE CONCEPT DESCRIPTION: ${cluster.description || 'No description available.'}

RELATED CONCEPTS IN THIS CLUSTER:
${neighborNames}

RULES:
- Start the response with a single '# ' heading that provides a clear, human-readable, and explanatory title for this topic.
- Write a comprehensive overview of this thematic area.
- Group the related concepts logically.
- Use ## sections (e.g., Overview, Key Themes, Sub-Concepts).
- Reference concepts using [[Concept Name]] wikilink syntax.
- Target 300-500 words.
- Do NOT include frontmatter or code fences.
- CRITICAL: The entire wiki page MUST be written in English.`;

    return {
      type: 'WIKI_TOPIC_MAP',
      prompt,
      tokensEstimate: 800,
      options: { taskName: `Wiki Topic: ${cluster.name}` },
      metadata: {
          type: 'wiki-topic-synthesis',
          concept: { id: cluster.id, name: cluster.name },
          tags: ['topic', 'moc']
      }
    };
  }
}
