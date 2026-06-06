export type DirectiveGoalType = 'explore' | 'build' | 'improve' | 'stop' | 'pivot' | 'research';
export type RoleStatus = 'active' | 'paused' | 'archived';
export type DirectiveStatus = 'active' | 'completed' | 'cancelled';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'materialized';
export type IdeaStatus = 'proposed' | 'reviewing' | 'approved' | 'rejected';
export type Visibility = 'public' | 'private' | 'internal';
export type ValidationMode = 'smoke' | 'deploy-preview' | 'none';
export type CouncilMode = 'idea-review' | 'technical-architecture' | 'repo-creation-review' | 'staffing-review' | 'deployment-readiness' | 'risk-review';

export interface Directive {
  id: string;
  title: string;
  description: string;
  goalType: DirectiveGoalType;
  constraints: Record<string, unknown>;
  priority: number;
  status: DirectiveStatus;
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
  providerPreferences: Record<string, unknown>;
  toolPermissions: string[];
  memoryNamespace: string;
  status: RoleStatus;
  approvalPolicy: Record<string, unknown>;
  canRecruit: boolean;
  canProposeRepo: boolean;
  canProvisionValidation: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  matchedPolicy: string;
}

export interface RoleCreationProposal {
  id: string;
  candidateRoleName: string;
  businessNeed: string;
  suggestedMission: string;
  suggestedPrompt: string;
  requiredPermissions: string[];
  confidence: number;
  sourceSignals: string[];
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaProposal {
  id: string;
  title: string;
  problemStatement: string;
  summary: string;
  sourceSignals: unknown[];
  strategicScore: number;
  feasibilityScore: number;
  noveltyScore: number;
  overallScore: number;
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
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
