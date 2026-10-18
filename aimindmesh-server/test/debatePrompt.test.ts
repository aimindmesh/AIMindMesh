import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn() }));
vi.mock('../src/services/InferenceRouter', () => ({ InferenceRouter: { routeTask: vi.fn(), setBrake: vi.fn() } }));
vi.mock('../src/services/SearchService', () => ({ SearchService: {} }));

import { DebateEngine } from '../src/services/DebateEngine';
import { InferenceRouter } from '../src/services/InferenceRouter';

const build = (DebateEngine as any).buildPrompt.bind(DebateEngine);

describe('debate prompts for prompt caching', () => {
  it('keep the context shared by a round apart from the turn of each participant', () => {
    const history = 'SYSTEM_RESEARCH: [1] result\n\nADVOCATE: first round';
    const advocate = build('You are ADVOCATE.', 'The insight', history, '');
    const critic = build('You are CRITIC.', 'The insight', history, '\n\nADVOCATE: second round');

    expect(advocate.cachePrefix).toBe(critic.cachePrefix);
    expect(advocate.cachePrefix).toContain('── ORIGINAL INSIGHT ──\nThe insight');
    expect(advocate.cachePrefix).toContain('── DEBATE SO FAR ──\n' + history);
    expect(critic.prompt.startsWith('You are CRITIC.')).toBe(true);
    expect(critic.prompt).toContain('── THIS ROUND SO FAR ──\nADVOCATE: second round');
    expect(advocate.prompt).not.toContain('THIS ROUND SO FAR');
    expect(critic.prompt).toContain('── RESEARCH DATA ──');
    expect(critic.prompt.trim().endsWith('ONLY in English.')).toBe(true);
  });

  it('sends the shared context as the cache prefix of the task', async () => {
    vi.mocked(InferenceRouter.routeTask).mockResolvedValue({ provider: 'CLAUDE', response: ' reply ' });
    const reply = await (DebateEngine as any).runInference('turn', 'Debate: X', 'shared');
    expect(reply).toBe('reply');
    expect(InferenceRouter.routeTask).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DEBATE_PARTICIPATION', prompt: 'turn', cachePrefix: 'shared',
    }));
  });
});
