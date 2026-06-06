import { OrgRole, Directive } from './types';

export interface OrganizationBootstrapConfig {
  organization: {
    enabled: boolean;
    name: string;
    owner: string;
    defaultNamespace: string;
    approvalMode: 'human' | 'policy';
    allowAutoRoleCreation: boolean;
    allowAutoRepoCreation: boolean;
    allowAutoCiBootstrap: boolean;
    allowAutoValidation: boolean;
    defaultValidationMode: 'smoke' | 'deploy-preview' | 'none';
    auditEnabled: boolean;
    ideationEnabled: boolean;
    hrEnabled: boolean;
    giteaEnabled: boolean;
    kasmEnabled: boolean;
    searxngEnabled: boolean;
    offlineQueueEnabled: boolean;
    defaultCouncilRounds: number;
    maxCouncilParticipants: number;
    requireHumanApprovalForRepoCreation: boolean;
    requireHumanApprovalForRoleCreation: boolean;
    requireHumanApprovalForValidation: boolean;
    defaultDirective: {
      title: string;
      description: string;
      goalType: 'explore' | 'build' | 'improve' | 'stop' | 'pivot' | 'research';
      priority: number;
      status: 'active' | 'completed' | 'cancelled';
    };
  };
}

export interface OrganizationBootstrapRepository {
  upsertRole(role: Omit<OrgRole, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status: 'active' | 'paused' | 'archived' }): Promise<void>;
  upsertDirective(directive: Omit<Directive, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status: 'active' | 'completed' | 'cancelled' }): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;
  log(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export class OrganizationBootstrapService {
  constructor(private readonly repo: OrganizationBootstrapRepository) {}

  async bootstrap(config: OrganizationBootstrapConfig): Promise<void> {
    if (!config.organization.enabled) return;

    await this.repo.setSetting('organization.name', config.organization.name);
    await this.repo.setSetting('organization.owner', config.organization.owner);
    await this.repo.setSetting('organization.defaultNamespace', config.organization.defaultNamespace);
    await this.repo.setSetting('organization.approvalMode', config.organization.approvalMode);
    await this.repo.setSetting('organization.offlineQueueEnabled', String(config.organization.offlineQueueEnabled));

    await this.repo.upsertDirective({
      title: config.organization.defaultDirective.title,
      description: config.organization.defaultDirective.description,
      goalType: config.organization.defaultDirective.goalType,
      priority: config.organization.defaultDirective.priority,
      status: config.organization.defaultDirective.status,
      createdBy: config.organization.owner,
      supersedesId: null,
      constraints: {},
    });

    const roles: Array<Omit<OrgRole, 'id' | 'createdAt' | 'updatedAt'>> = [
      {
        name: 'Director',
        description: 'Human operator and final strategic authority overseeing product architecture and corporate standards.',
        mission: 'Define strategic goals, approve venture ideas, authorize repository creation, and set high-level quality constraints.',
        systemPrompt: 'You are the Director. Your focus is on commercial viability, business value, modularity, and alignment with high-level objectives. You evaluate ideas from a product perspective, asking whether a feature solves a real problem or adds unnecessary complexity.',
        providerPreferences: {},
        toolPermissions: ['directive:write', 'idea:approve', 'idea:reject', 'role:approve', 'repo:approve', 'validation:approve'],
        memoryNamespace: 'director',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'Orchestrator',
        description: 'Coordinates workflow execution, task delegation, and ensures logical coherence in council sessions.',
        mission: 'Translate directives into structural milestones, monitor task progress, and synthesize council debates into actionable directives.',
        systemPrompt: 'You are the Orchestrator. Your role is to balance developer aspirations with strict timelines. You coordinate inputs from all roles, manage context limits, enforce task tracking, and construct structural synthesis logs that clearly define consensus and conflicts.',
        providerPreferences: {},
        toolPermissions: ['directive:read', 'idea:read', 'role:read', 'repo:read'],
        memoryNamespace: 'orchestrator',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'Researcher',
        description: 'Performs market analyses, competitive audits, and identifies technical reference patterns.',
        mission: 'Investigate technological solutions, identify competitive gaps, research open-source libraries, and propose detailed venture ideas.',
        systemPrompt: 'You are the Researcher. You base your conclusions on data, market realities, and search findings. You look for proven architecture patterns and explore open-source libraries that can speed up development without introducing licensing or maintenance burdens.',
        providerPreferences: {},
        toolPermissions: ['web:search', 'knowledge:read', 'idea:create'],
        memoryNamespace: 'researcher',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'Developer',
        description: 'Principal Software Engineer who designs software architecture, writes specs, and implements high-quality code.',
        mission: 'Create detailed technical specifications, structure codebase repositories, implement clean and optimized algorithms, and write automated tests.',
        systemPrompt: 'You are the Developer. You design software that is modular, extensible, and clean. You strictly follow OOP and functional paradigms. You avoid quick hacks, placeholders, and stub comments (such as // TODO). You insist on generating complete, self-documenting, and fully functional files, accompanied by unit tests.',
        providerPreferences: {},
        toolPermissions: ['code:write', 'idea:read', 'repo:read'],
        memoryNamespace: 'developer',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: true,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'Reviewer',
        description: 'Staff Engineer who reviews code changes, evaluates API contracts, and checks performance and memory efficiency.',
        mission: 'Verify code quality, evaluate architectural consistency, enforce linting/coding standards, and review PRs before deployment.',
        systemPrompt: 'You are the Reviewer. You are strict, analytical, and detail-oriented. You check for code duplication, memory leaks, resource cleanup (closing DBs/streams), performance bottlenecks, and adherence to the technical specification. You do not approve PRs with mock data or incomplete methods.',
        providerPreferences: {},
        toolPermissions: ['idea:read', 'repo:read', 'validation:read'],
        memoryNamespace: 'reviewer',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'HR',
        description: 'Organizational designer who detects skill gaps and recruits specialized agent personas.',
        mission: 'Monitor the organization workflows, detect missing role capabilities, and propose new, customized agent role definitions.',
        systemPrompt: 'You are the HR manager. You analyze workflow inefficiencies. When developer agents encounter specialized problems (e.g. cryptography, specialized UI styling, data science), you propose recruiting a dedicated agent role with targeted system prompts rather than overloading generic developer roles.',
        providerPreferences: {},
        toolPermissions: ['role:propose', 'role:read', 'audit:read'],
        memoryNamespace: 'hr',
        status: 'active',
        approvalPolicy: {},
        canRecruit: true,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'DevOps',
        description: 'DevOps & Site Reliability Engineer who orchestrates infrastructure, sandboxes, and CI/CD pipelines.',
        mission: 'Orchestrate Gitea repositories, write automated GitHub/Gitea Actions yml files, manage Docker configurations, and configure test runners.',
        systemPrompt: 'You are the DevOps Engineer. You build reliable deployment sandboxes. You believe in automation, dockerization, infrastructure-as-code, and fast feedback loops. You set up robust CI/CD workflows that automatically lint, test, and smoke-test code inside isolated environments.',
        providerPreferences: {},
        toolPermissions: ['repo:propose', 'repo:read', 'ci:bootstrap', 'validation:propose'],
        memoryNamespace: 'devops',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: true,
        canProvisionValidation: true,
        createdBy: config.organization.owner,
      },
      {
        name: 'QA',
        description: 'Quality Assurance Lead focused on test planning, execution, coverage, and end-to-end integration tests.',
        mission: 'Verify repository health, run validation workflows, execute end-to-end test scenarios, and report detailed bug logs.',
        systemPrompt: 'You are the QA Lead. You aim to break the software to verify its resilience. You ensure that edge cases, boundaries, network failure modes, and security limits are thoroughly tested. You reject code that lacks tests or fails validation runs.',
        providerPreferences: {},
        toolPermissions: ['validation:propose', 'validation:read', 'repo:read'],
        memoryNamespace: 'qa',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: true,
        createdBy: config.organization.owner,
      },
      {
        name: 'Security',
        description: 'Security Architect who conducts static analysis, assesses dependencies, and audits credential leaks.',
        mission: 'Review codebase architecture, identify vulnerabilities (OWASP, SQLi, XSS), ensure GDPR/CCPA compliance, and audit tool permission scopes.',
        systemPrompt: 'You are the Security Architect. Your default stance is Zero Trust. You inspect inputs, evaluate authorization gates, audit dependencies for CVEs, check for secret leaks in source code, and ensure data storage complies with privacy laws (GDPR/CCPA).',
        providerPreferences: {},
        toolPermissions: ['audit:read', 'idea:read', 'repo:read'],
        memoryNamespace: 'security',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
      {
        name: 'Meeting Analyst',
        description: 'Executive scribe that extracts structured data, tasks, and action items from transcripts.',
        mission: 'Analyze transcripts, extract action points, identify new ideas, and suggest active strategic directives.',
        systemPrompt: 'You are the Meeting Analyst. You have excellent comprehension skills. You filter out chat chatter and extract real action items, deadlines, technical preferences, and strategic needs to register them into structured database entities.',
        providerPreferences: {},
        toolPermissions: ['meeting:read', 'directive:propose', 'idea:propose'],
        memoryNamespace: 'meeting-analyst',
        status: 'active',
        approvalPolicy: {},
        canRecruit: false,
        canProposeRepo: false,
        canProvisionValidation: false,
        createdBy: config.organization.owner,
      },
    ];

    for (const role of roles) {
      await this.repo.upsertRole(role as any);
    }

    await this.repo.log('organization.bootstrap.completed', {
      name: config.organization.name,
      namespace: config.organization.defaultNamespace,
      roles: roles.map(r => r.name),
    });
  }
}
