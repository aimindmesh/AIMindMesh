import { describe, expect, it } from 'vitest';
import { deepMerge } from '../src/utils/deepMerge';

describe('deepMerge (PATCH /api/admin/config)', () => {
  it('merges objects key by key', () => {
    const stored = { gemini: { apiKey: 'k', model: 'a' }, logging: { level: 'INFO' } };
    deepMerge(stored, { gemini: { model: 'b' } });
    expect(stored).toEqual({ gemini: { apiKey: 'k', model: 'b' }, logging: { level: 'INFO' } });
  });

  it('replaces lists, so a shorter one really shortens them', () => {
    const stored = { routing: { taskPriorities: { GENERAL_CHAT: ['CLAUDE', 'GEMINI', 'LAPTOP'] } }, debate: { participants: [{ name: 'A' }, { name: 'B' }] } };
    deepMerge(stored, { routing: { taskPriorities: { GENERAL_CHAT: ['GEMINI'] } }, debate: { participants: [{ name: 'B' }] } });
    expect(stored.routing.taskPriorities.GENERAL_CHAT).toEqual(['GEMINI']);
    expect(stored.debate.participants).toEqual([{ name: 'B' }]);
  });

  it('sets null and new sections, and ignores prototype-polluting keys', () => {
    const stored: any = { claude: { agents: { monthlyBudgetUsd: 20 } } };
    deepMerge(stored, JSON.parse('{"claude":{"agents":{"monthlyBudgetUsd":null}},"wiki":{"enabled":true},"__proto__":{"polluted":true}}'));
    expect(stored.claude.agents.monthlyBudgetUsd).toBeNull();
    expect(stored.wiki).toEqual({ enabled: true });
    expect(({} as any).polluted).toBeUndefined();
  });
});
