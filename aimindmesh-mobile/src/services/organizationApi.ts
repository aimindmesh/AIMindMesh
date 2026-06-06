import { AIMindMeshServerSettings } from '../types';

export interface Directive {
  id: string;
  title: string;
  description: string;
  goalType: 'explore' | 'build' | 'improve' | 'stop' | 'pivot' | 'research';
  constraints: Record<string, any>;
  priority: number;
  status: 'active' | 'completed' | 'cancelled';
  createdBy: string;
  supersedesId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgRole {
  id: string;
  name: string;
  description: string;
  mission: string;
  systemPrompt: string;
  providerPreferences: Record<string, any>;
  toolPermissions: string[];
  memoryNamespace: string;
  status: 'active' | 'paused' | 'archived';
  approvalPolicy: Record<string, any>;
  canRecruit: boolean;
  canProposeRepo: boolean;
  canProvisionValidation: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaProposal {
  id: string;
  title: string;
  problemStatement: string;
  summary: string;
  sourceSignals: string[];
  strategicScore: number;
  feasibilityScore: number;
  noveltyScore: number;
  overallScore: number;
  status: 'proposed' | 'reviewing' | 'approved' | 'rejected';
  analysisSynthesis?: string | null;
  humanFeedback?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  target_type: string;
  target_id: string;
  payload: string;
  created_at: string;
}

export interface DiscoveryConfig {
  enabled: boolean;
  cronExpression: string;
  maxTopicsPerCycle: number;
  minScoreThreshold: number;
  autoCouncil: boolean;
  minAutoCouncilScore: number;
  lastRunAt: string | null;
  updatedAt: string;
  isRunning?: boolean;
}

function headers(settings: AIMindMeshServerSettings) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
  };
}

function base(settings: AIMindMeshServerSettings) {
  return settings.serverUrl.replace(/\/$/, '');
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
    if (!resp.ok) throw new Error(`Idea review failed: ${resp.status}`);
    return await resp.json();
  },

  async approveIdea(settings: AIMindMeshServerSettings, ideaId: string) {
    const resp = await fetch(`${base(settings)}/api/organization/ideas/${ideaId}/approve`, {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Idea approve failed: ${resp.status}`);
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

  async getRepositories(settings: AIMindMeshServerSettings) {
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
    if (!resp.ok) throw new Error(`Validation trigger failed: ${resp.status}`);
    return await resp.json();
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

