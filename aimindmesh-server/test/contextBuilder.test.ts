import { describe, expect, it, vi } from 'vitest';
import { SERVER_ROOT } from './fixtures/config';
import { MultiFileContextBuilder } from '../src/services/MultiFileContextBuilder';

describe('MultiFileContextBuilder never sends secrets to the LLM', () => {
  const gitea = { getFileContent: vi.fn(async () => 'REMOTE CONTENT') };
  const builder = new MultiFileContextBuilder(gitea as any, SERVER_ROOT);

  it('refuses a secret target', async () => {
    await expect(builder.build('aimindmesh-server/config.json', 'AIMindMesh')).rejects.toThrow(/secret/);
    await expect(builder.build('config.json', 'AIMindMesh')).rejects.toThrow(/secret/);
  });

  it('reads other repositories from Gitea only', async () => {
    const ctx = await builder.build('config.json', 'my-app');
    expect(ctx.target.content).toBe('REMOTE CONTENT');
    expect(ctx.relatedFiles).toEqual([]);
    expect(gitea.getFileContent).toHaveBeenCalledWith('config.json', 'my-app');
  });

  it('ignores traversal and secret paths in affectedComponents', async () => {
    const ctx = await builder.build('aimindmesh-server/src/services/ImprovementDetector.ts', 'AIMindMesh', 'high',
      ['../../../../../../etc/passwd', 'aimindmesh-server/openclaw-config/openclaw.json']);
    const related = ctx.relatedFiles.map(f => f.content).join('\n');
    expect(related).not.toContain('root:x:0');
    expect(ctx.relatedFiles.some(f => f.path.includes('openclaw-config'))).toBe(false);
  });

  it('shares only the ServerConfig interface, not deployment defaults', async () => {
    const ctx = await builder.build('aimindmesh-server/src/services/ImprovementDetector.ts', 'AIMindMesh', 'high');
    const configTypes = ctx.relatedFiles.find(f => f.relationship === 'config_types');
    expect(configTypes?.content).toContain('autoEvolution');
    expect(configTypes?.content).not.toContain('loadConfig');
    expect(configTypes?.content).not.toMatch(/10\.2\.0\.\d+|ddns/);
  });
});
