import { serverApi } from './serverApi';
import type { Directive, OrgRole, IdeaProposal, AuditLogEntry, DiscoveryConfig } from '@aimindmesh/api-types';

// Organization types come from the server contract (aimindmesh-server/src/types/api.ts)
export type { Directive, OrgRole, IdeaProposal, AuditLogEntry, DiscoveryConfig };

export const organizationApi = {
  getRoles: () =>
    serverApi.get<{ success: boolean; roles: OrgRole[] }>('/api/organization/roles'),

  createRole: (role: Omit<OrgRole, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) =>
    serverApi.post<{ success: boolean; role: OrgRole }>('/api/organization/roles', role),

  updateRole: (roleId: string, patch: Partial<OrgRole>) =>
    serverApi.put<{ success: boolean; role: OrgRole }>(`/api/organization/roles/${roleId}`, patch),

  archiveRole: (roleId: string) =>
    serverApi.delete<{ success: boolean }>(`/api/organization/roles/${roleId}`),

  getDirectives: () =>
    serverApi.get<{ success: boolean; directives: Directive[] }>('/api/organization/directives'),

  createDirective: (directive: { title: string; description: string; goalType: string; priority: number; constraints?: any }) =>
    serverApi.post<{ success: boolean; directive: Directive }>('/api/organization/directives', directive),

  cancelDirective: (directiveId: string) =>
    serverApi.delete<{ success: boolean }>(`/api/organization/directives/${directiveId}`),

  getAuditLogs: () =>
    serverApi.get<{ success: boolean; logs: AuditLogEntry[] }>('/api/organization/audit'),

  getIdeas: () =>
    serverApi.get<{ success: boolean; ideas: IdeaProposal[] }>('/api/organization/ideas'),

  discoverIdeas: (topic: string) =>
    serverApi.post<{ success: boolean; ideas: IdeaProposal[] }>('/api/organization/ideas/discover', { topic }),

  createIdea: (idea: { title: string; problemStatement?: string; summary?: string; sourceSignals?: string[]; strategicScore?: number; feasibilityScore?: number; noveltyScore?: number; overallScore?: number }) =>
    serverApi.post<{ success: boolean; idea: IdeaProposal }>('/api/organization/ideas', idea),

  updateIdea: (ideaId: string, update: { title: string; problemStatement: string; summary: string }) =>
    serverApi.put<{ success: boolean }>(`/api/organization/ideas/${ideaId}`, update),

  reviewIdea: (ideaId: string, humanFeedback?: string) =>
    serverApi.post<{ success: boolean; consensus: boolean; synthesis: string }>(`/api/organization/ideas/${ideaId}/review`, { humanFeedback }),

  approveIdea: (ideaId: string) =>
    serverApi.post<{ success: boolean }>(`/api/organization/ideas/${ideaId}/approve`),

  deleteIdea: (ideaId: string) =>
    serverApi.delete<{ success: boolean }>(`/api/organization/ideas/${ideaId}`),

  generateDirectivesFromIdea: (ideaId: string) =>
    serverApi.post<{ success: boolean; directives: Directive[] }>(`/api/organization/ideas/${ideaId}/generate-directives`),

  transitionIdeaToDevelopment: (ideaId: string) =>
    serverApi.post<{ success: boolean }>(`/api/organization/ideas/${ideaId}/transition`),

  getIdeaDesign: (ideaId: string) =>
    serverApi.get<any>(`/api/organization/ideas/${ideaId}/design`),

  getRepositories: () =>
    serverApi.get<{ success: boolean; repositories: any[] }>('/api/organization/repositories'),

  createRepository: (repo: { namespace?: string; repoName: string; description?: string; visibility?: string; bootstrapTemplate?: string; enableCiCd?: boolean; createdFromIdeaId?: string }) =>
    serverApi.post<{ success: boolean; repository: { id: string; url: string; repoName: string } }>('/api/organization/repositories', repo),

  bootstrapCiCd: (repoId: string) =>
    serverApi.post<{ success: boolean }>(`/api/organization/repositories/${repoId}/bootstrap-ci`),

  runValidation: (repoId: string) =>
    serverApi.post<{ success: boolean; result: { status: string; summary: string; logs: string[] } }>(`/api/organization/repositories/${repoId}/validate`),

  forceDevelop: (repoId: string) =>
    serverApi.post<{ success: boolean }>(`/api/organization/repositories/${repoId}/force-develop`),

  getHRProposals: () =>
    serverApi.get<{ success: boolean; proposals: any[] }>('/api/organization/hr/proposals'),

  analyzeRecruitment: () =>
    serverApi.post<{ success: boolean; proposal: any }>('/api/organization/hr/recruitment/analyze'),

  materializeProposal: (proposalId: string) =>
    serverApi.post<{ success: boolean; role: any }>(`/api/organization/hr/proposals/${proposalId}/materialize`),

  updateProposal: (proposalId: string, update: any) =>
    serverApi.put<{ success: boolean }>(`/api/organization/hr/proposals/${proposalId}`, update),

  deleteProposal: (proposalId: string) =>
    serverApi.delete<{ success: boolean }>(`/api/organization/hr/proposals/${proposalId}`),

  getDiscoveryStatus: () =>
    serverApi.get<{ success: boolean; status: DiscoveryConfig & { isRunning: boolean } }>('/api/organization/autonomous-discovery/status'),

  updateDiscoveryConfig: (patch: Partial<DiscoveryConfig>) =>
    serverApi.patch<{ success: boolean; config: DiscoveryConfig }>('/api/organization/autonomous-discovery/config', patch),

  triggerDiscovery: () =>
    serverApi.post<{ success: boolean; started: boolean; ideasFound: number; message?: string }>('/api/organization/autonomous-discovery/trigger'),
};

