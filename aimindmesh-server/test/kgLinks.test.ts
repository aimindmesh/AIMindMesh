import { beforeEach, describe, expect, it, vi } from 'vitest';

const neo = vi.hoisted(() => ({ calls: [] as { query: string; params: any }[] }));
vi.mock('../src/db/neo4j', () => ({
  driver: {},
  getSession: () => ({
    run: async (query: string, params: any) => {
      neo.calls.push({ query, params });
      // upsertConcept returns the id of the merged concept
      return { records: query.includes('MERGE (c:Concept') ? [{ get: () => `id-of-${params.name}` }] : [] };
    },
    close: async () => {},
  }),
}));
const mocks = vi.hoisted(() => ({ routeTask: vi.fn() }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { routeTask: mocks.routeTask } }));
vi.mock('../src/services/OpenClawBridge', () => ({ runAgentTask: vi.fn() }));
vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

import { ProactiveEngine } from '../src/services/ProactiveEngine';
import { KGManager } from '../src/services/KGManager';

beforeEach(() => { neo.calls.length = 0; });

describe('knowledge graph links', () => {
  it('enrichment links the Insight to each Concept by the id upsertConcept returned', async () => {
    mocks.routeTask.mockResolvedValue({ response: JSON.stringify({ facts: [{ conceptName: 'Solar power', content: 'c', relation: 'MENTIONS' }] }) });

    await (ProactiveEngine as any).runEnrichment('insight-1');

    const link = neo.calls.find(c => c.query.includes('MATCH (i:Insight {id: $insightId})'));
    expect(link?.params).toMatchObject({ insightId: 'insight-1', conceptId: 'id-of-Solar power' });
    expect(link?.query).toContain('[r:`MENTIONS`]');
  });

  it('relation types from the LLM cannot inject Cypher', async () => {
    await KGManager.linkInsightToConcept('i', 'c', 'X]->(n) DETACH DELETE n //');
    expect(neo.calls[0].query).toContain('[r:`X____n__DETACH_DELETE_n___`]');
  });

  it('an empty embedding or a plain description never overwrite enriched data', async () => {
    await KGManager.upsertConcept('Solar power', 'Extracted from doc.pdf', []);
    const { query } = neo.calls[0];
    expect(query).toContain('CASE WHEN size($embedding) > 0 THEN $embedding ELSE c.embedding END');
    expect(query).toContain('CASE WHEN $enriched OR NOT coalesce(c.enriched, false) THEN $description ELSE c.description END');
    expect(query).toContain('c.enriched = $enriched OR coalesce(c.enriched, false)');
  });
});
