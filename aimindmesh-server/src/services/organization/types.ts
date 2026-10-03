// Contract types shared with the clients live in types/api.ts
export type {
  DirectiveGoalType, RoleStatus, DirectiveStatus, ProposalStatus, IdeaStatus,
  Directive, OrgRole, RoleCreationProposal, IdeaProposal,
} from '../../types/api';

export type Visibility = 'public' | 'private' | 'internal';
export type ValidationMode = 'smoke' | 'deploy-preview' | 'none';
export type CouncilMode = 'idea-review' | 'technical-architecture' | 'repo-creation-review' | 'staffing-review' | 'deployment-readiness' | 'risk-review';

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  matchedPolicy: string;
}

export interface RepoProvisionRequest {
  namespace: string;
  repoName: string;
  description: string;
  visibility: Visibility;
  bootstrapTemplate: string;
  enableCiCd: boolean;
  validationMode?: ValidationMode;
}

export interface ValidationResult {
  status: 'passed' | 'failed' | 'pending';
  summary: string;
  logs: string[];
}
