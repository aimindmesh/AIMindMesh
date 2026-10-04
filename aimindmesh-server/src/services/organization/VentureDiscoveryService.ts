import { randomUUID } from 'crypto';
import { SearchService } from '../SearchService';
import db from '../../db/sqlite';
import { InferenceRouter } from '../InferenceRouter';
import { Logger } from '../../utils/Logger';
import { Parser } from '../../utils/Parser';
import { OpportunityScoringService } from './OpportunityScoringService';
import type { DiscoveredIdea } from './venture/IdeaStore';
import type { SourceRef } from '../../types/api';

const QUERIES_PER_TOPIC = 3;
const RESULTS_PER_QUERY = 6;
const MAX_RESULTS = 12;
const IDEAS_PER_TOPIC = 2;
const MIN_SOURCES = 2;
const REJECTED_MEMORY = 30;

interface SearchHit extends SourceRef {
  snippet: string;
}

interface Candidate {
  title: string;
  problemStatement: string;
  summary: string;
  sources: SourceRef[];
}

const clamp01 = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Turns a topic into product ideas grounded in web evidence.
 *
 * 1. A planner writes a few searches (pain points, alternatives, communities).
 * 2. The generator proposes ideas that must cite at least two numbered results; it never scores
 *    them, and it sees the ideas already rejected or closed so it does not propose them again.
 * 3. A separate judge scores each idea against the evidence and explains why.
 * Unparsable answers yield no idea: there is no generic fallback.
 */
export class VentureDiscoveryService {
  private readonly scorer = new OpportunityScoringService();

  async discoverIdeas(topic: string): Promise<DiscoveredIdea[]> {
    const hits = await this.research(topic);
    if (hits.length < MIN_SOURCES) {
      Logger.warn('VentureDiscovery', `Not enough evidence for "${topic.slice(0, 80)}" (${hits.length} results)`);
      return [];
    }
    try {
      const candidates = await this.generate(topic, hits);
      if (candidates.length === 0) return [];
      return await this.judge(candidates, hits);
    } catch (err: any) {
      Logger.warn('VentureDiscovery', `Discovery failed for "${topic.slice(0, 80)}": ${err.message}`);
      return [];
    }
  }

  /** Planned searches, deduplicated by URL and numbered for citation. */
  private async research(topic: string): Promise<SearchHit[]> {
    const queries = await this.planQueries(topic);
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const query of queries) {
      const results = await SearchService.search(query, { deep: false, numResults: RESULTS_PER_QUERY });
      for (const r of results) {
        if (!/^https?:\/\//.test(r.url) || seen.has(r.url)) continue;
        seen.add(r.url);
        hits.push({ title: r.title || r.url, url: r.url, snippet: (r.content || '').slice(0, 400) });
      }
      if (hits.length >= MAX_RESULTS) break;
    }
    return hits.slice(0, MAX_RESULTS);
  }

  private async planQueries(topic: string): Promise<string[]> {
    const fallback = [topic, `${topic} problems frustrations`, `${topic} alternatives`];
    try {
      const response = await InferenceRouter.complete(`Write ${QUERIES_PER_TOPIC} web search queries to find evidence of unmet needs about: ${topic}
One query about user complaints or pain points, one about existing tools and their alternatives, one about discussions in communities (forums, issue trackers).
Return ONLY a JSON array of ${QUERIES_PER_TOPIC} strings.`, 'QUERY_EXPANSION', { taskName: `Discovery queries: ${topic.slice(0, 60)}` });
      const queries = Parser.parseLLMJsonArray(response).filter((q): q is string => typeof q === 'string' && q.trim().length > 2).map(q => q.trim().slice(0, 200));
      return queries.length ? queries.slice(0, QUERIES_PER_TOPIC) : fallback;
    } catch {
      return fallback;
    }
  }

  private rejectedIdeas(): string[] {
    try {
      const rows = db.prepare(`SELECT title, status, outcome_notes FROM organization_ideas WHERE status IN ('rejected', 'killed')
                               ORDER BY updated_at DESC LIMIT ?`).all(REJECTED_MEMORY) as { title: string; status: string; outcome_notes: string | null }[];
      return rows.map(r => `- ${r.title} (${r.status}${r.outcome_notes ? `: ${r.outcome_notes.slice(0, 160)}` : ''})`);
    } catch {
      return [];
    }
  }

  private async generate(topic: string, hits: SearchHit[]): Promise<Candidate[]> {
    const results = hits.map((h, i) => `[${i + 1}] ${h.title} (${h.url})\n${h.snippet}`).join('\n\n');
    const rejected = this.rejectedIdeas();
    const response = await InferenceRouter.complete(`You research software product opportunities for a one-person team with an AI coding agent.

TOPIC: ${topic}

NUMBERED WEB RESULTS:
${results}

ALREADY REJECTED OR CLOSED (do not propose these or close variants):
${rejected.join('\n') || '(none)'}

Propose up to ${IDEAS_PER_TOPIC} distinct software products that solve a problem the results give evidence of.
Each needs a clear target user and must be buildable as a small Node.js library, CLI or HTTP API in a few milestones.
Each idea must cite at least ${MIN_SOURCES} result numbers that show the problem or the gap.
Do not reuse product names that appear in the results. Do not propose generic "AI platform" ideas.

Return ONLY a JSON array. Each element has exactly these keys:
- "title": product name and a short descriptor (max 80 characters)
- "problemStatement": the user problem, as shown by the cited results (1-3 sentences)
- "summary": what the product does and for whom (1-3 sentences)
- "sourceIds": array of the result numbers the idea relies on`, 'PROACTIVE_INSIGHT', { taskName: `Discover ideas: ${topic.slice(0, 60)}` });

    return Parser.parseLLMJsonArray(response).slice(0, IDEAS_PER_TOPIC).map((item: any): Candidate | null => {
      const title = text(item?.title, 120);
      const problemStatement = text(item?.problemStatement, 1000);
      const summary = text(item?.summary, 1000);
      const ids: unknown[] = Array.isArray(item?.sourceIds) ? item.sourceIds : [];
      const sources = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= hits.length))]
        .map(n => ({ title: hits[n - 1].title, url: hits[n - 1].url }));
      if (!title || !problemStatement || !summary || sources.length < MIN_SOURCES) return null;
      return { title, problemStatement, summary, sources };
    }).filter((c): c is Candidate => c !== null);
  }

  /** A second model call scores the ideas against the evidence; ideas it does not score are dropped. */
  private async judge(candidates: Candidate[], hits: SearchHit[]): Promise<DiscoveredIdea[]> {
    const evidence = (c: Candidate) => c.sources.map(s => {
      const hit = hits.find(h => h.url === s.url);
      return `  - ${s.title}: ${hit?.snippet.slice(0, 250) ?? ''}`;
    }).join('\n');
    const ideas = candidates.map((c, i) => `IDEA ${i + 1}: ${c.title}\nProblem: ${c.problemStatement}\nProduct: ${c.summary}\nEvidence:\n${evidence(c)}`).join('\n\n');

    const response = await InferenceRouter.complete(`You are a skeptical product judge. Score each idea strictly from its evidence.

${ideas}

Scores are numbers between 0 and 1:
- strategic: the evidence shows a real, recurring problem for an identifiable user
- feasibility: one AI coding agent can build a useful first version as a Node.js library/CLI/API in at most 4 milestones
- novelty: existing tools leave a clear gap (low if the results show mature alternatives)
- privacy: it can work self-hosted without collecting personal data
- maintenance: low ongoing cost (no fragile scraping, no heavy third-party dependencies)

Return ONLY a JSON array with one element per idea: {"idea": idea number, "strategic", "feasibility", "novelty", "privacy", "maintenance", "rationale": "2-3 sentences"}`, 'ORGANIZATION_DESIGN', { taskName: 'Discovery judge' });

    const verdicts = Parser.parseLLMJsonArray(response);
    const now = new Date().toISOString();
    const out: DiscoveredIdea[] = [];
    candidates.forEach((candidate, i) => {
      const verdict = verdicts.find((v: any) => Number(v?.idea) === i + 1);
      if (!verdict) return;
      const base = {
        id: randomUUID(), title: candidate.title, problemStatement: candidate.problemStatement, summary: candidate.summary,
        sourceSignals: [], strategicScore: 0, feasibilityScore: 0, noveltyScore: 0, overallScore: 0,
        status: 'proposed' as const, createdAt: now, updatedAt: now,
      };
      const scored = this.scorer.applyScore(base, {
        strategic: clamp01(verdict.strategic),
        feasibility: clamp01(verdict.feasibility),
        novelty: clamp01(verdict.novelty),
        privacy: clamp01(verdict.privacy),
        maintenance: clamp01(verdict.maintenance),
      });
      out.push({ ...scored, sources: candidate.sources, judgeRationale: text(verdict.rationale, 1000) || null });
    });
    return out;
  }
}
