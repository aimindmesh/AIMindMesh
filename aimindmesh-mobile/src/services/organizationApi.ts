import { AIMindMeshServerSettings } from '../types';
import type {
  Directive, OrgRole, IdeaProposal, AuditLogEntry, DiscoveryConfig, VentureRepository, VentureBuildConfig, SourceRef,
  VentureMilestone, VentureDecision,
} from '@aimindmesh/api-types';

// Organization types come from the server contract (aimindmesh-server/src/types/api.ts)
export type { Directive, OrgRole, IdeaProposal, AuditLogEntry, DiscoveryConfig, VentureRepository, VentureBuildConfig, SourceRef, VentureMilestone, VentureDecision };

function headers(settings: AIMindMeshServerSettings) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
  };
}

function base(settings: AIMindMeshServerSettings) {
  return settings.serverUrl.replace(/\/$/, '');
}

/** The server's own explanation (e.g. "Venture builds are disabled…") when it gives one. */
async function failure(resp: Response, label: string): Promise<Error> {
  try {
    const body = await resp.json();
    if (body?.error) return new Error(body.error);
  } catch {
    // no JSON body
  }
  return new Error(`${label}: ${resp.status}`);
}

export const organizationApi = {
  async getDirectives(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/directives`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Directives fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.directives || [];
  },

  async createDirective(settings: AIMindMeshServerSettings, payload: any) {
    const resp = await fetch(`${base(settings)}/api/organization/directives`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Directive create failed: ${resp.status}`);
    const data = await resp.json();
    return data.directive;
  },

  async cancelDirective(settings: AIMindMeshServerSettings, id: string) {
    const resp = await fetch(`${base(settings)}/api/organization/directives/${id}`, {
      method: 'DELETE',
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Directive cancel failed: ${resp.status}`);
    return await resp.json();
  },

  async getIdeas(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Ideas fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.ideas || [];
  },

  async discoverIdeas(settings: AIMindMeshServerSettings, topic: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/discover`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ topic }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Ideas discovery failed: ${resp.status}`);
    const data = await resp.json();
    return data.ideas || [];
  },

  async createIdea(settings: AIMindMeshServerSettings, idea: any) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(idea),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Idea create failed: ${resp.status}`);
    const data = await resp.json();
    return data.idea;
  },

  async updateIdea(settings: AIMindMeshServerSettings, ideaId: string, update: { title: string; problemStatement: string; summary: string }) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}`, {
      method: 'PUT',
      headers: headers(settings),
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Idea update failed: ${resp.status}`);
    return await resp.json();
  },

  async getRoles(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/roles`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Roles fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.roles || [];
  },

  async createRole(settings: AIMindMeshServerSettings, role: any) {
    const resp = await fetch(`${base(settings)}/api/organization/roles`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(role),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Role create failed: ${resp.status}`);
    const data = await resp.json();
    return data.role;
  },

  async archiveRole(settings: AIMindMeshServerSettings, roleId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/roles/${roleId}`, {
      method: 'DELETE',
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Role archive failed: ${resp.status}`);
    return await resp.json();
  },

  async updateRole(settings: AIMindMeshServerSettings, roleId: string, patch: any) {
    const resp = await fetch(`${base(settings)}/api/organization/roles/${roleId}`, {
      method: 'PUT',
      headers: headers(settings),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Role update failed: ${resp.status}`);
    const data = await resp.json();
    return data.role;
  },

  async getAuditSummary(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/audit`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Audit fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.logs || [];
  },

  async reviewIdea(settings: AIMindMeshServerSettings, ideaId: string, humanFeedback?: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/review`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ humanFeedback }),
      signal: AbortSignal.timeout(60000),
    });
    // 202: the council runs in the background, the verdict arrives with the ideas list
    if (!resp.ok) throw await failure(resp, 'Idea review failed');
    return await resp.json();
  },

  async approveIdea(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/approve`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw await failure(resp, 'Idea approve failed');
    return await resp.json();
  },

  async deleteIdea(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}`, {
      method: 'DELETE',
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Idea delete failed: ${resp.status}`);
    return await resp.json();
  },

  async getRepositories(settings: AIMindMeshServerSettings): Promise<VentureRepository[]> {
    const resp = await fetch(`${base(settings)}/api/organization/repositories`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Repos fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.repositories || [];
  },

  async createRepository(settings: AIMindMeshServerSettings, repo: any) {
    const resp = await fetch(`${base(settings)}/api/organization/repositories`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(repo),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Repo create failed: ${resp.status}`);
    const data = await resp.json();
    return data.repository;
  },

  async bootstrapCiCd(settings: AIMindMeshServerSettings, repoId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/repositories/${repoId}/bootstrap-ci`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`CI bootstrap failed: ${resp.status}`);
    return await resp.json();
  },

  async runValidation(settings: AIMindMeshServerSettings, repoId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/repositories/${repoId}/validate`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) throw await failure(resp, 'Validation trigger failed');
    return await resp.json();
  },

  async forceDevelop(settings: AIMindMeshServerSettings, repoId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/repositories/${repoId}/force-develop`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw await failure(resp, 'Develop failed');
    return await resp.json();
  },

  async decideVenture(settings: AIMindMeshServerSettings, ideaId: string, decision: VentureDecision, notes: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/decision`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({ decision, notes }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw await failure(resp, 'Decision failed');
    return await resp.json();
  },

  async cancelRun(settings: AIMindMeshServerSettings, repoId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/repositories/${repoId}/cancel`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw await failure(resp, 'Cancel failed');
    return await resp.json();
  },

  async getBuildConfig(settings: AIMindMeshServerSettings): Promise<VentureBuildConfig | null> {
    const resp = await fetch(`${base(settings)}/api/organization/build-config`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null; // older servers have no build settings
    const data = await resp.json();
    return data.config ?? null;
  },

  async updateBuildConfig(settings: AIMindMeshServerSettings, patch: Partial<VentureBuildConfig>): Promise<VentureBuildConfig> {
    const resp = await fetch(`${base(settings)}/api/organization/build-config`, {
      method: 'PATCH',
      headers: headers(settings),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw await failure(resp, 'Build settings update failed');
    const data = await resp.json();
    return data.config;
  },

  async getHRProposals(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/hr/proposals`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`HR proposals fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.proposals || [];
  },

  async analyzeRecruitment(settings: AIMindMeshServerSettings) {
    const resp = await fetch(`${base(settings)}/api/organization/hr/recruitment/analyze`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Recruitment analysis failed: ${resp.status}`);
    const data = await resp.json();
    return data.proposal;
  },

  async materializeProposal(settings: AIMindMeshServerSettings, proposalId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/hr/proposals/${proposalId}/materialize`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Proposal materialization failed: ${resp.status}`);
    const data = await resp.json();
    return data.role;
  },

  async updateProposal(settings: AIMindMeshServerSettings, proposalId: string, update: any) {
    const resp = await fetch(`${base(settings)}/api/organization/hr/proposals/${proposalId}`, {
      method: 'PUT',
      headers: headers(settings),
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Proposal update failed: ${resp.status}`);
    return await resp.json();
  },

  async deleteProposal(settings: AIMindMeshServerSettings, proposalId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/hr/proposals/${proposalId}`, {
      method: 'DELETE',
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Proposal delete failed: ${resp.status}`);
    return await resp.json();
  },

  async getDiscoveryStatus(settings: AIMindMeshServerSettings): Promise<DiscoveryConfig & { isRunning: boolean }> {
    const resp = await fetch(`${base(settings)}/api/organization/autonomous-discovery/status`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Discovery status fetch failed: ${resp.status}`);
    const data = await resp.json();
    return data.status;
  },

  async updateDiscoveryConfig(settings: AIMindMeshServerSettings, patch: Partial<DiscoveryConfig>): Promise<DiscoveryConfig> {
    const resp = await fetch(`${base(settings)}/api/organization/autonomous-discovery/config`, {
      method: 'PATCH',
      headers: headers(settings),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Discovery config update failed: ${resp.status}`);
    const data = await resp.json();
    return data.config;
  },

  async triggerDiscovery(settings: AIMindMeshServerSettings): Promise<{ started: boolean; ideasFound: number; message?: string }> {
    const resp = await fetch(`${base(settings)}/api/organization/autonomous-discovery/trigger`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`Discovery trigger failed: ${resp.status}`);
    return await resp.json();
  },

  async generateDirectivesFromIdea(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/generate-directives`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error(`Generate directives failed: ${resp.status}`);
    return await resp.json();
  },

  async transitionIdeaToDevelopment(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/transition`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error(`Transition idea to development failed: ${resp.status}`);
    return await resp.json();
  },

  async getIdeaDesign(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/design`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Idea design fetch failed: ${resp.status}`);
    return await resp.json();
  },

  async getSessionHistory(settings: AIMindMeshServerSettings, sessionKey: string) {
    const resp = await fetch(`${base(settings)}/api/agent/sessions/${sessionKey}/history`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Session history fetch failed: ${resp.status}`);
    return await resp.json();
  },

  async getSessionStatus(settings: AIMindMeshServerSettings, sessionKey: string) {
    const resp = await fetch(`${base(settings)}/api/agent/sessions/${sessionKey}/status`, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Session status fetch failed: ${resp.status}`);
    return await resp.json();
  },

  async clearSession(settings: AIMindMeshServerSettings, sessionKey: string) {
    const resp = await fetch(`${base(settings)}/api/agent/sessions/${sessionKey}`, {
      method: 'DELETE',
      headers: headers(settings),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Session clear failed: ${resp.status}`);
    return await resp.json();
  },
};

