import { describe, expect, it } from 'vitest';
import {
  effectiveProvider, apiKeyForProvider, compressionBudget, streamDisplayText, buildToolTurnText,
  buildObservationMessage, mergeTextThinking, extractInlineMemories, cleanFinalAnswer, shouldNudgeModel
} from '../src/hooks/chat/agentLoopHelpers';
import type { LLMConfig, AIMindMeshServerSettings } from '../src/types';

const keys = { gemini: 'G', perplexity: 'P', claude: 'C' };
const config = (extra: Partial<LLMConfig>) => ({ provider: 'gemini', ...extra }) as LLMConfig;

describe('provider and key selection', () => {
  it('never sends another vendor key', () => {
    expect(apiKeyForProvider('openrouter', keys, config({ openrouterApiKey: 'OR' }))).toBe('OR');
    expect(apiKeyForProvider('openrouter', keys, config({}))).toBeUndefined();
    expect(apiKeyForProvider('claude', keys, config({}))).toBe('C');
    expect(apiKeyForProvider('native-gguf', keys, config({}))).toBeUndefined();
  });

  it('uses the server fallback provider when the server answers', () => {
    const server = { fallbackProvider: 'perplexity' } as AIMindMeshServerSettings;
    expect(effectiveProvider(config({ provider: 'aimindmesh-server' }), server)).toBe('perplexity');
    expect(effectiveProvider(config({ provider: 'claude' }), server)).toBe('claude');
  });

  it('compresses history only for on-device engines, scaled to their context', () => {
    expect(compressionBudget('gemini', config({ nCtx: 2048 }), 1500)).toBe(Infinity);
    expect(compressionBudget('native-gguf', config({ nCtx: 2048 }), 1500)).toBe(1500);
    expect(compressionBudget('litert', config({ nCtx: 8192 }), 1500)).toBe(8192 - 1500 - 1000);
  });
});

describe('tool turns', () => {
  it('builds the observation from the given batch only', () => {
    const msg = buildObservationMessage([{ name: 'search_web', success: true, result: 'r1' }, { name: 'x', success: false, result: 'denied' }], 'id');
    expect(msg.role).toBe('user');
    expect(msg.text).toBe('Observation:\n[search_web]: r1\n\n[x]: Failed - denied');
  });

  it('records the call canonically and drops narration before a tool without Answer:', () => {
    const turn = buildToolTurnText('I will search now <tool>search_web({"query":"a"})</tool>', 'plan', [{ name: 'search_web', args: { query: 'a' } }]);
    expect(turn).toBe('<thinking>plan</thinking>\n<tool>search_web({"query":"a"})</tool>');
  });

  it('keeps thinking streamed as text', () => {
    expect(mergeTextThinking('', '<thinking>check files</thinking><tool>ls()</tool>')).toBe('check files');
    expect(mergeTextThinking('check files', '<thinking>check files</thinking>')).toBe('check files');
  });
});

describe('displayed text', () => {
  it('shows only the answer part and hides tool JSON and memory tags', () => {
    expect(streamDisplayText('thinking...\nAnswer: Hello')).toBe('Hello');
    expect(streamDisplayText('<tool>x({})</tool>')).toBe('');
    expect(streamDisplayText('Hi <save_memory>likes tea</save_memory>', 'Working')).toBe('Hi \n\n_Working_');
  });

  it('cleans the final answer and extracts inline memories', () => {
    expect(cleanFinalAnswer('<thinking>t</thinking>Final Answer: Done <save_memory>m</save_memory>')).toBe('Done');
    expect(extractInlineMemories('a <save_memory> likes tea </save_memory> b <save_memory>cut')).toEqual(['likes tea', 'cut']);
  });

  it('nudges only after a very short thought with no answer, before the last step', () => {
    expect(shouldNudgeModel('', 'Let me think', 0, 5)).toBe(true);
    expect(shouldNudgeModel('An answer', 'Let me think', 0, 5)).toBe(false);
    expect(shouldNudgeModel('', 'Let me think', 4, 5)).toBe(false);
  });
});
