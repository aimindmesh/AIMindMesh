import { OrgRole, PolicyDecision } from './types';

export class RolePolicyService {
  private readonly deny = (reason: string, matchedPolicy: string, requiresApproval = true): PolicyDecision => ({
    allowed: false,
    requiresApproval,
    reason,
    matchedPolicy,
  });

  private readonly allow = (reason: string, matchedPolicy: string): PolicyDecision => ({
    allowed: true,
    requiresApproval: false,
    reason,
    matchedPolicy,
  });

  evaluate(action: string, role: OrgRole | null, payload: Record<string, unknown> = {}): PolicyDecision {
    if (!role) return this.deny('Unknown role', 'role:missing');

    const perms = new Set(role.toolPermissions || []);

    if (action === 'directive:create') {
      return perms.has('directive:write') ? this.allow('Role can create directives', 'directive:write') : this.deny('No directive write permission', 'directive:write');
    }

    if (action === 'role:create') {
      return role.canRecruit ? this.allow('Role can recruit roles', 'role:recruit') : this.deny('Role cannot recruit', 'role:recruit');
    }

    if (action === 'gitea:repo:create') {
      return role.canProposeRepo ? this.allow('Role can propose repository creation', 'gitea:repo:create') : this.deny('Role cannot create repositories', 'gitea:repo:create');
    }

    if (action === 'kasm:validate') {
      return role.canProvisionValidation ? this.allow('Role can provision validation', 'kasm:validate') : this.deny('Role cannot provision validation', 'kasm:validate');
    }

    if (action === 'research:web') {
      return perms.has('web:search') ? this.allow('Role can research web', 'web:search') : this.deny('Role cannot search web', 'web:search');
    }

    if (action === 'code:write') {
      return perms.has('code:write') ? this.allow('Role can write code', 'code:write') : this.deny('Role cannot write code', 'code:write');
    }

    return this.deny('Default deny', 'default-deny');
  }
}
