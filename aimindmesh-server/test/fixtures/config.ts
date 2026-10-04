import path from 'node:path';
import type { ServerConfig } from '../../src/config';

/**
 * Test replacement for src/config.ts (see vitest.config.mts): no config.json, no real keys.
 * Tests may mutate it; every test file gets its own copy.
 */
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  server: { port: 3030, apiKey: 'test-global-key' },
  auth: { keys: { phone: 'test-node-key' } },
  ollama: { baseUrl: 'http://127.0.0.1:1', defaultModel: 'test', embeddingModel: 'test' },
  gemini: { apiKey: '', model: 'test', dailyQuotaCap: 0 },
  openrouter: { apiKey: '', model: 'test', dailyQuotaCap: 0 },
  freellmapi: { enabled: false, baseUrl: 'http://127.0.0.1:1', apiKey: '', timeoutMs: 1000, model: 'test' },
  neo4j: { uri: 'bolt://127.0.0.1:1', user: 'neo4j', password: 'test' },
  fcm: { serviceAccountPath: './missing-service-account.json' },
  routing: { preferredNode: 'AUTO', taskPriorities: {} },
  logging: { level: 'ERROR' },
  infrastructureBrake: false,
  autoEvolution: {
    enabled: false,
    cronExpression: '0 3 * * *',
    maxProposalsPerDay: 3,
    minSeverityThreshold: 6,
    minConfidenceThreshold: 0.65,
    requireComplexTier: false,
    validationTimeoutMs: 120000,
    giteaRepoOwner: 'tests',
    giteaRepoName: 'aimindmesh',
    giteaDeveloperUsername: 'tests',
    repoLocalPath: SERVER_ROOT,
    autoMerge: false,
    giteaWebhookSecret: 'whsec-test',
    // Running vitest inside every ValidationLayer test is slow: test/relatedTests.test.ts enables it
    runRelatedTests: false,
  },
  organization: { enabled: true, allowAutoRepoCreation: false, searxngBaseUrl: 'http://127.0.0.1:1' },
} as unknown as ServerConfig;

export function loadConfig(): ServerConfig {
  return config;
}
