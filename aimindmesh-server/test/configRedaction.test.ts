import { describe, expect, it } from 'vitest';
import { REDACTED, redactConfig, stripRedacted } from '../src/utils/configRedaction';

const sample = {
  server: { port: 3030, apiKey: 'k1' },
  neo4j: { uri: 'bolt://x', user: 'neo4j', password: 'pw' },
  gemini: { apiKey: 'g', model: 'm', dailyQuotaCap: 5 },
  kasm: { apiKey: 'a', apiKeySecret: 'b', baseUrl: 'https://k' },
  auth: { keys: { phone: 'nk' } },
  autoEvolution: { giteaWebhookSecret: 's', repoLocalPath: '/app' },
  fcm: { serviceAccountPath: './f.json', testToken: 't' },
  llm: { maxTokens: 2048 },
  openclaw: { defaultSessionKey: 'main' },
  freellmapi: { apiKey: '', baseUrl: 'http://x' },
  claude: { apiKey: 'sk-ant-x', models: { STANDARD: 'claude-sonnet-5-5' }, agents: { proxyKeys: ['hermes-key-123'], model: 'claude-sonnet-5-5' } },
};

describe('redactConfig', () => {
  const red = redactConfig(sample);

  it('masks every credential', () => {
    for (const value of [red.server.apiKey, red.neo4j.password, red.gemini.apiKey, red.kasm.apiKey,
      red.kasm.apiKeySecret, red.auth.keys.phone, red.autoEvolution.giteaWebhookSecret, red.fcm.testToken,
      red.claude.apiKey, red.claude.agents.proxyKeys[0]]) {
      expect(value).toBe(REDACTED);
    }
  });

  it('leaves non-secrets and empty values untouched', () => {
    expect(red.server.port).toBe(3030);
    expect(red.neo4j.user).toBe('neo4j');
    expect(red.llm.maxTokens).toBe(2048);
    expect(red.openclaw.defaultSessionKey).toBe('main');
    expect(red.kasm.baseUrl).toBe('https://k');
    expect(red.freellmapi.apiKey).toBe('');
    expect(red.claude.models.STANDARD).toBe('claude-sonnet-5-5');
    expect(red.claude.agents.model).toBe('claude-sonnet-5-5');
  });

  it('does not mutate the live config', () => {
    expect(sample.server.apiKey).toBe('k1');
  });
});

describe('stripRedacted', () => {
  it('drops masked values so they never overwrite real secrets', () => {
    const stripped = stripRedacted({ server: { apiKey: REDACTED, port: 4000 }, gemini: { apiKey: 'new' } });
    expect(stripped.server).toEqual({ port: 4000 });
    expect(stripped.gemini.apiKey).toBe('new');
  });

  it('keeps the Claude key and the agent keys when a client sends the masked config back', () => {
    const stripped = stripRedacted(redactConfig(sample));
    expect(stripped.claude.apiKey).toBeUndefined();
    // Dropped whole: arrays replace the stored value, an empty list would wipe the real keys
    expect('proxyKeys' in stripped.claude.agents).toBe(false);
    expect(stripped.claude.agents.model).toBe('claude-sonnet-5-5');
  });

  it('drops prototype-polluting keys', () => {
    const stripped = stripRedacted(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"ok":1}'));
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.keys(stripped)).toEqual(['ok']);
  });
});
