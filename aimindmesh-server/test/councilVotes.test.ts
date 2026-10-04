import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { complete: mocks.complete } }));

import { CouncilOrchestrator, parseVote, selectParticipants, tallyVotes } from '../src/services/organization/CouncilOrchestrator';
import { RolePolicyService } from '../src/services/organization/RolePolicyService';
import type { OrgRole } from '../src/types/api';

const role = (name: string, status: OrgRole['status'] = 'active') => ({ id: name, name, status, mission: 'm', description: 'd', systemPrompt: 's' }) as OrgRole;
const roles = ['Director', 'Meeting Analyst', 'HR', 'QA', 'Researcher', 'Security', 'Developer', 'Reviewer', 'DevOps', 'Crypto Expert'].map(n => role(n));
const idea = { id: 'i', title: 'Idea', problemStatement: 'p', summary: 's' } as any;

beforeEach(() => { mocks.complete.mockReset(); });

describe('council votes', () => {
  it('picks the preferred voting roles and never the Director', () => {
    const picked = selectParticipants([...roles, role('Archived', 'archived')], ['Researcher', 'Developer', 'Reviewer', 'Security', 'QA'], 6);
    expect(picked.map(r => r.name)).toEqual(['Researcher', 'Developer', 'Reviewer', 'Security', 'QA', 'HR']);
  });

  it('parses structured votes and marks anything else invalid', () => {
    expect(parseVote('QA', '```json\n{"vote":"Approve","confidence":2,"conditions":["tests"]}\n```')).toEqual({ role: 'QA', vote: 'approve', confidence: 1, conditions: ['tests'] });
    expect(parseVote('QA', 'I approve this idea, no concerns.').vote).toBe('invalid');
  });

  it('needs two thirds of at least three valid votes', () => {
    const v = (vote: 'approve' | 'reject' | 'invalid') => ({ role: 'r', vote, confidence: 1, conditions: [] });
    expect(tallyVotes([v('approve'), v('approve'), v('reject')]).consensus).toBe(true);
    expect(tallyVotes([v('approve'), v('reject'), v('reject')]).consensus).toBe(false);
    expect(tallyVotes([v('approve'), v('approve'), v('invalid'), v('invalid')]).consensus).toBe(false);
  });

  it('decides from the votes, not from the words of the synthesis', async () => {
    mocks.complete.mockImplementation(async (prompt: string) => {
      if (prompt.startsWith('You are the Council Orchestrator')) return 'There was no consensus on pricing, but approval is recommended.';
      if (prompt.includes('[ROUND 2 OF 2]')) return '{"vote":"approve","confidence":0.8,"conditions":["ship tests"],"argument":"Solid."}';
      return 'Initial assessment.';
    });
    const result = await new CouncilOrchestrator(new RolePolicyService()).reviewIdea('idea-review', idea, roles);
    expect(result.consensus).toBe(true);
    expect(result.votes).toHaveLength(6);
    expect(result.synthesis).toContain('**Consensus: Yes** (6 approve, 0 reject)');
    // 6 participants x 2 rounds + synthesis
    expect(mocks.complete).toHaveBeenCalledTimes(13);
  });
});
