import { beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../src/db/sqlite';

const mocks = vi.hoisted(() => ({ search: vi.fn(), complete: vi.fn() }));
vi.mock('../src/services/SearchService', () => ({ SearchService: { search: mocks.search } }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: mocks.complete } }));

import { VentureDiscoveryService } from '../src/services/organization/VentureDiscoveryService';
import { isDuplicateTitle, saveDiscovered } from '../src/services/organization/venture/IdeaStore';

const hits = [
  { title: 'Users hate manual invoices', url: 'https://forum.example/a', content: 'complaints' },
  { title: 'Alternatives to X', url: 'https://blog.example/b', content: 'list' },
  { title: 'Issue: export is broken', url: 'https://git.example/c', content: 'issue' },
];

const idea = (title: string, sourceIds: unknown[]) => ({ title, problemStatement: 'Freelancers lose time on invoices', summary: 'Generates invoices', sourceIds });

/** Answers by stage: planner (QUERY_EXPANSION), generator (PROACTIVE_INSIGHT), judge (ORGANIZATION_DESIGN). */
function script(stages: { queries?: unknown; ideas: unknown; verdicts: unknown }) {
  mocks.complete.mockImplementation(async (_prompt: string, type: string) => {
    if (type === 'QUERY_EXPANSION') return JSON.stringify(stages.queries ?? ['invoice pain points', 'invoice tools alternatives', 'invoice forum issues']);
    if (type === 'PROACTIVE_INSIGHT') return JSON.stringify(stages.ideas);
    return JSON.stringify(stages.verdicts);
  });
}

beforeEach(() => {
  db.prepare('DELETE FROM organization_ideas').run();
  mocks.search.mockReset();
  mocks.search.mockResolvedValue(hits);
  mocks.complete.mockReset();
});

describe('venture discovery', () => {
  it('searches the planned queries, keeps cited sources and takes the scores from the judge', async () => {
    script({
      ideas: [idea('InvoiceSnap', [1, 3, 9, 'x'])],
      verdicts: [{ idea: 1, strategic: 3, feasibility: 0.8, novelty: -1, privacy: 0.9, maintenance: 0.7, rationale: 'Clear pain in [1].' }],
    });
    // a one-element array (parseLLMJson used to return its object and lose the idea)
    const [found] = await new VentureDiscoveryService().discoverIdeas('freelance tools');

    expect(mocks.search.mock.calls.map(c => c[0])).toEqual(['invoice pain points', 'invoice tools alternatives', 'invoice forum issues']);
    expect(found.sources.map(s => s.url)).toEqual(['https://forum.example/a', 'https://git.example/c']);
    expect(found).toMatchObject({ strategicScore: 1, noveltyScore: 0, judgeRationale: 'Clear pain in [1].' });
    const generatorPrompt = mocks.complete.mock.calls.find(c => c[1] === 'PROACTIVE_INSIGHT')![0] as string;
    expect(generatorPrompt).not.toMatch(/TradeSimX|Example format/i);
    expect(generatorPrompt).toContain('[1] Users hate manual invoices');
  });

  it('drops ideas with fewer than two sources, unscored ideas and unparsable answers', async () => {
    script({ ideas: [idea('One source', [1]), idea('Unscored', [1, 2])], verdicts: [] });
    expect(await new VentureDiscoveryService().discoverIdeas('t')).toEqual([]);

    mocks.complete.mockResolvedValue('Sorry, I cannot help with that.');
    expect(await new VentureDiscoveryService().discoverIdeas('t')).toEqual([]);
  });

  it('shows the generator the rejected and closed ideas', async () => {
    db.prepare(`INSERT INTO organization_ideas (id, title, problem_statement, summary, source_signals, strategic_score, feasibility_score,
                novelty_score, overall_score, status, outcome_notes, created_at, updated_at)
                VALUES ('k', 'Old Invoice Bot', 'p', 's', '[]', 0, 0, 0, 0, 'killed', 'nobody paid for it', 'n', 'n')`).run();
    script({ ideas: [], verdicts: [] });
    await new VentureDiscoveryService().discoverIdeas('t');
    const generatorPrompt = mocks.complete.mock.calls.find(c => c[1] === 'PROACTIVE_INSIGHT')![0] as string;
    expect(generatorPrompt).toContain('Old Invoice Bot (killed: nobody paid for it)');
  });

  it('saves new ideas once and skips duplicates and low scores', async () => {
    script({
      ideas: [idea('Invoice Snap: invoices from time logs', [1, 2]), idea('Weak idea', [1, 2])],
      verdicts: [
        { idea: 1, strategic: 0.9, feasibility: 0.9, novelty: 0.9, privacy: 0.9, maintenance: 0.9, rationale: 'good' },
        { idea: 2, strategic: 0.1, feasibility: 0.1, novelty: 0.1, privacy: 0.1, maintenance: 0.1, rationale: 'weak' },
      ],
    });
    const first = saveDiscovered(await new VentureDiscoveryService().discoverIdeas('t'), 0.55);
    expect(first.saved.map(i => i.title)).toEqual(['Invoice Snap: invoices from time logs']);
    expect(first.skipped).toEqual([{ title: 'Weak idea', reason: 'low_score' }]);
    expect(first.saved[0].sourceSignals).toEqual([
      'Users hate manual invoices — https://forum.example/a', 'Alternatives to X — https://blog.example/b',
    ]);

    const second = saveDiscovered(await new VentureDiscoveryService().discoverIdeas('t'), 0.55);
    expect(second.saved).toEqual([]);
    expect(second.skipped[0]).toEqual({ title: 'Invoice Snap: invoices from time logs', reason: 'duplicate' });
    const row = db.prepare('SELECT sources_json, judge_rationale FROM organization_ideas').get() as { sources_json: string; judge_rationale: string };
    expect(JSON.parse(row.sources_json)).toHaveLength(2);
    expect(row.judge_rationale).toBe('good');
  });

  it('detects near-duplicate titles', () => {
    expect(isDuplicateTitle('Invoice Snap for Freelancers', ['invoice snap for freelancers!'])).toBe(true);
    expect(isDuplicateTitle('Invoice Snap for busy Freelancers', ['Invoice Snap for Freelancers'])).toBe(true);
    expect(isDuplicateTitle('Garden Planner', ['Invoice Snap for Freelancers'])).toBe(false);
  });
});
