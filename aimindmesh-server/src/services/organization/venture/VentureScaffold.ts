import fs from 'node:fs';
import path from 'node:path';
import { InferenceRouter } from '../../InferenceRouter';
import { Parser } from '../../../utils/Parser';
import type { VentureSpec, VentureTemplate } from './VentureSpec';

export const ACCEPTANCE_DIR = 'acceptance';
// Files the platform owns in every venture repository (restored before each validation)
export const CANONICAL_CONFIG = 'vitest.config.ts';

export function templateDir(template: VentureTemplate): string {
  return path.resolve(__dirname, '../../../../templates/ventures', template);
}

function listFiles(root: string, rel = ''): string[] {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(entry => {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(root, child) : [child];
  });
}

/** Template files with the product name filled in. */
export function scaffoldFiles(template: VentureTemplate, slug: string, title: string): Record<string, string> {
  const root = templateDir(template);
  const out: Record<string, string> = {};
  for (const rel of listFiles(root)) {
    out[rel] = fs.readFileSync(path.join(root, rel), 'utf-8').split('__NAME__').join(slug).split('__TITLE__').join(title);
  }
  return out;
}

/** The files restored before every validation: the test config and the acceptance tests. */
export function canonicalFiles(template: VentureTemplate, acceptance: Record<string, string>): Record<string, string> {
  return {
    [CANONICAL_CONFIG]: fs.readFileSync(path.join(templateDir(template), CANONICAL_CONFIG), 'utf-8'),
    ...acceptance,
  };
}

export const acceptancePath = (criterionId: string) => `${ACCEPTANCE_DIR}/${criterionId}.test.ts`;

/** AC id of an acceptance test file path (relative or absolute), or null. */
export function criterionOfFile(file: string): string | null {
  const match = /(?:^|\/)acceptance\/(AC-\d+)\.test\.ts$/.exec(file.replace(/\\/g, '/'));
  return match ? match[1] : null;
}

const HARNESS: Record<VentureTemplate, string> = {
  'node-library': `import { describe, it, expect } from 'vitest';
import { /* exported functions */ } from '../src/index';`,
  'node-api': `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server';
// start createServer() on port 0 in beforeAll, close it in afterAll, call it with fetch`,
};

/**
 * Writes one vitest file per acceptance criterion, against the public interface only, before
 * the code exists. These files belong to the server: the agent cannot change them.
 */
export async function generateAcceptanceTests(title: string, spec: VentureSpec, criteriaIds: string[]): Promise<Record<string, string>> {
  const criteria = spec.acceptanceCriteria.filter(c => criteriaIds.includes(c.id));
  const files: Record<string, string> = {};
  let missing = criteria.map(c => c.id);

  for (let attempt = 0; attempt < 2 && missing.length > 0; attempt++) {
    const wanted = criteria.filter(c => missing.includes(c.id));
    const response = await InferenceRouter.complete(`Write the acceptance tests of "${title}" (vitest, TypeScript).

Public interface (the only thing tests may use):
${spec.publicInterface}

Template: ${spec.template}. Every file starts like:
${HARNESS[spec.template]}

Criteria (one test file each):
${wanted.map(c => `- ${c.id}: Given ${c.given}, when ${c.when}, then ${c.then}.`).join('\n')}

Rules: tests run without network access (only 127.0.0.1); no mocks of the code under test; each test title starts
with the criterion id in brackets, e.g. it('[AC-1] ...'); deterministic data only.
Return ONLY a JSON array: [{"criterion": "AC-1", "content": "full file content"}]`, 'ORGANIZATION_DESIGN', { taskName: `Acceptance tests: ${title}` });

    for (const item of Parser.parseLLMJsonArray(response)) {
      const id = typeof item?.criterion === 'string' ? item.criterion.trim() : '';
      const content = typeof item?.content === 'string' ? item.content : '';
      if (!missing.includes(id) || !content.includes(`[${id}]`) || !content.includes("from 'vitest'")) continue;
      files[acceptancePath(id)] = content.endsWith('\n') ? content : `${content}\n`;
    }
    missing = missing.filter(id => !files[acceptancePath(id)]);
  }
  if (missing.length > 0) throw new Error(`No usable acceptance test for ${missing.join(', ')}`);
  return files;
}
