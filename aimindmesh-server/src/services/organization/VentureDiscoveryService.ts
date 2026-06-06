import { randomUUID } from 'crypto';
import { IdeaProposal } from './types';
import { SearchService } from '../SearchService';
import db from '../../db/sqlite';
import { InferenceRouter } from '../InferenceRouter';
import { OpportunityScoringService } from './OpportunityScoringService';

export class VentureDiscoveryService {
  private readonly scorer = new OpportunityScoringService();

  async discoverIdeas(topic: string): Promise<IdeaProposal[]> {
    let searchResults: Array<{ title: string; url: string; snippet: string }> = [];
    try {
      const results = await SearchService.search(topic, { deep: false });
      searchResults = results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content
      }));
    } catch (e) {
      console.error('SearXNG search failed:', e);
    }

    let internalSignals: string[] = [];
    try {
      const feedItems = db.prepare(`
        SELECT content FROM feed_items 
        WHERE type = 'INSIGHT' 
        ORDER BY created_at DESC LIMIT 5
      `).all() as Array<{ content: string }>;
      internalSignals = feedItems.map(item => item.content);
    } catch (e) {
      console.error('Internal signals retrieval failed:', e);
    }

    const contextText = [
      ...searchResults.map(r => `Search result: ${r.title} - ${r.snippet}`),
      ...internalSignals.map(s => `Internal Insight: ${s}`)
    ].join('\n');

    const prompt = `Based on the following signals:
${contextText}

Generate 2 unique software idea proposals addressing the topic "${topic}".
Provide the response strictly as a JSON array of objects. Do not include markdown formatting or reasoning.
Each object must contain the following keys:
- title: string
- problemStatement: string
- summary: string
- strategicScore: number (0.0 to 1.0)
- feasibilityScore: number (0.0 to 1.0)
- noveltyScore: number (0.0 to 1.0)
- privacyScore: number (0.0 to 1.0)
- maintenanceScore: number (0.0 to 1.0)

Example format:
[
  {
    "title": "Local LLM Router",
    "problemStatement": "High cloud costs",
    "summary": "Router for Gemma and Gemini",
    "strategicScore": 0.9,
    "feasibilityScore": 0.8,
    "noveltyScore": 0.7,
    "privacyScore": 0.95,
    "maintenanceScore": 0.85
  }
]`;

    try {
      const responseText = await InferenceRouter.complete(prompt, 'PROACTIVE_INSIGHT', {
        taskName: `Discover ideas: ${topic}`
      });

      let cleanJson = responseText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.substring(7);
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.substring(0, cleanJson.length - 3);
      }
      cleanJson = cleanJson.trim();

      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => {
          const baseIdea: IdeaProposal = {
            id: randomUUID(),
            title: item.title || `Venture: ${topic}`,
            problemStatement: item.problemStatement || '',
            summary: item.summary || '',
            sourceSignals: [contextText],
            strategicScore: Number(item.strategicScore) || 0.5,
            feasibilityScore: Number(item.feasibilityScore) || 0.5,
            noveltyScore: Number(item.noveltyScore) || 0.5,
            overallScore: 0.5,
            status: 'proposed',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          return this.scorer.applyScore(baseIdea, {
            strategic: Number(item.strategicScore) || 0.5,
            feasibility: Number(item.feasibilityScore) || 0.5,
            novelty: Number(item.noveltyScore) || 0.5,
            privacy: Number(item.privacyScore) || 0.5,
            maintenance: Number(item.maintenanceScore) || 0.5,
          });
        });
      }
    } catch (err) {
      console.error('LLM idea discovery parsing failed, falling back:', err);
    }

    // Baseline fallback
    const fallbackIdea: IdeaProposal = {
      id: randomUUID(),
      title: `Software idea around ${topic}`,
      problemStatement: `Create a solution for ${topic}`,
      summary: `Automated research idea for ${topic}`,
      sourceSignals: [contextText],
      strategicScore: 0.5,
      feasibilityScore: 0.5,
      noveltyScore: 0.5,
      overallScore: 0.5,
      status: 'proposed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return [
      this.scorer.applyScore(fallbackIdea, {
        strategic: 0.6,
        feasibility: 0.5,
        novelty: 0.5,
        privacy: 0.7,
        maintenance: 0.5
      })
    ];
  }
}

