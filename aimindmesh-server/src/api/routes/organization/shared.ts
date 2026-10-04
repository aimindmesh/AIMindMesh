import { SQLiteOrganizationRoleRepository, OrganizationRegistry } from '../../../services/organization/OrganizationRegistry';
import { RoleLifecycleService } from '../../../services/organization/RoleLifecycleService';
import { SQLiteDirectiveRepository, DirectiveService } from '../../../services/organization/DirectiveService';
import { RolePolicyService } from '../../../services/organization/RolePolicyService';
import { OrganizationAuditService } from '../../../services/organization/OrganizationAuditService';

// Singletons shared by the organization route modules
export const roleRepo = new SQLiteOrganizationRoleRepository();
export const registry = new OrganizationRegistry(roleRepo);
export const lifecycle = new RoleLifecycleService(roleRepo);

export const directiveRepo = new SQLiteDirectiveRepository();
export const directiveService = new DirectiveService(directiveRepo);

export const auditService = new OrganizationAuditService();
export const policyService = new RolePolicyService();
