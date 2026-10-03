import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './fixtures/config';
import db from '../src/db/sqlite';

const mocks = vi.hoisted(() => ({ characterizeIdea: vi.fn(), audit: vi.fn(), broadcast: vi.fn() }));

vi.mock('../src/services/FCMDispatcher', () => ({ sendToDevice: vi.fn(async () => {}) }));
vi.mock('../src/services/NotificationService', () => ({ NotificationService: { broadcast: mocks.broadcast } }));
vi.mock('../src/services/organization/VentureDiscoveryService', () => ({ VentureDiscoveryService: class {} }));
vi.mock('../src/services/organization/DirectiveService', () => ({ SQLiteDirectiveRepository: class {}, DirectiveService: class {} }));
vi.mock('../src/services/organization/OrganizationAuditService', () => ({
  OrganizationAuditService: class { log = mocks.audit; },
}));
vi.mock('../src/services/organization/OrganizationRegistry', () => ({
  SQLiteOrganizationRoleRepository: class {},
  OrganizationRegistry: class { async listRoles() { return [{ status: 'active' }]; } },
}));
vi.mock('../src/services/organization/RolePolicyService', () => ({ RolePolicyService: class {} }));
vi.mock('../src/services/organization/CouncilOrchestrator', () => ({
  CouncilOrchestrator: class { async reviewIdea() { return { consensus: true, synthesis: 'approved by the council' }; } },
}));
vi.mock('../src/services/organization/DesignOrchestrator', () => ({ DesignOrchestrator: { characterizeIdea: mocks.characterizeIdea } }));

import { AutonomousVentureEngine } from '../src/services/organization/AutonomousVentureEngine';

const triggerAutoCouncil = (id: string) => (AutonomousVentureEngine as any).triggerAutoCouncil(id, 'Idea');

beforeEach(() => {
  db.prepare(`INSERT OR REPLACE INTO organization_ideas (id, title, problem_statement, summary, source_signals, strategic_score,
              feasibility_score, novelty_score, overall_score, status, created_at, updated_at)
              VALUES ('idea1', 'Idea', 'p', 's', '[]', 0.9, 0.9, 0.9, 0.9, 'proposed', '', '')`).run();
  mocks.characterizeIdea.mockClear();
  mocks.audit.mockClear();
});

describe('autonomous council', () => {
  it('waits for a human before creating repositories (default)', async () => {
    (config as any).organization.allowAutoRepoCreation = false;
    await triggerAutoCouncil('idea1');
    expect(mocks.characterizeIdea).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'idea:auto-council-awaiting-human' }));
    const idea = db.prepare(`SELECT status FROM organization_ideas WHERE id = 'idea1'`).get() as { status: string };
    expect(idea.status).toBe('approved');
  });

  it('keeps the fully autonomous path when explicitly allowed', async () => {
    (config as any).organization.allowAutoRepoCreation = true;
    await triggerAutoCouncil('idea1');
    expect(mocks.characterizeIdea).toHaveBeenCalledWith('idea1');
  });
});
