import db from '../../db/sqlite';
import { OrgRole } from './types';

export interface OrganizationRoleRepository {
  list(): Promise<OrgRole[]>;
  findById(id: string): Promise<OrgRole | null>;
  findByName(name: string): Promise<OrgRole | null>;
  insert(role: OrgRole): Promise<void>;
  update(id: string, patch: Partial<OrgRole>): Promise<void>;
}

export class SQLiteOrganizationRoleRepository implements OrganizationRoleRepository {
  private mapRow(row: any): OrgRole {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      mission: row.mission,
      systemPrompt: row.system_prompt,
      providerPreferences: JSON.parse(row.provider_preferences || '{}'),
      toolPermissions: JSON.parse(row.tool_permissions || '[]'),
      memoryNamespace: row.memory_namespace,
      status: row.status as any,
      approvalPolicy: JSON.parse(row.approval_policy || '{}'),
      canRecruit: !!row.can_recruit,
      canProposeRepo: !!row.can_propose_repo,
      canProvisionValidation: !!row.can_provision_validation,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async list(): Promise<OrgRole[]> {
    const rows = db.prepare('SELECT * FROM organization_roles WHERE status != ?').all('archived');
    return rows.map(r => this.mapRow(r));
  }

  async findById(id: string): Promise<OrgRole | null> {
    const row = db.prepare('SELECT * FROM organization_roles WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  async findByName(name: string): Promise<OrgRole | null> {
    const row = db.prepare('SELECT * FROM organization_roles WHERE name = ?').get(name);
    return row ? this.mapRow(row) : null;
  }

  async insert(role: OrgRole): Promise<void> {
    db.prepare(`
      INSERT INTO organization_roles (
        id, name, description, mission, system_prompt, provider_preferences, tool_permissions,
        memory_namespace, status, approval_policy, can_recruit, can_propose_repo, can_provision_validation,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      role.id,
      role.name,
      role.description,
      role.mission,
      role.systemPrompt,
      JSON.stringify(role.providerPreferences),
      JSON.stringify(role.toolPermissions),
      role.memoryNamespace,
      role.status,
      JSON.stringify(role.approvalPolicy),
      role.canRecruit ? 1 : 0,
      role.canProposeRepo ? 1 : 0,
      role.canProvisionValidation ? 1 : 0,
      role.createdBy,
      role.createdAt,
      role.updatedAt
    );
  }

  async update(id: string, patch: Partial<OrgRole>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      mission: 'mission',
      systemPrompt: 'system_prompt',
      providerPreferences: 'provider_preferences',
      toolPermissions: 'tool_permissions',
      memoryNamespace: 'memory_namespace',
      status: 'status',
      approvalPolicy: 'approval_policy',
      canRecruit: 'can_recruit',
      canProposeRepo: 'can_propose_repo',
      canProvisionValidation: 'can_provision_validation',
      updatedAt: 'updated_at'
    };

    for (const [key, val] of Object.entries(patch)) {
      const dbField = fieldMap[key];
      if (dbField) {
        fields.push(`${dbField} = ?`);
        if (typeof val === 'boolean') {
          values.push(val ? 1 : 0);
        } else if (typeof val === 'object' && val !== null) {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE organization_roles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export class OrganizationRegistry {
  constructor(private readonly repo: OrganizationRoleRepository) {}

  async listRoles(): Promise<OrgRole[]> {
    return this.repo.list();
  }

  async getRole(id: string): Promise<OrgRole | null> {
    return this.repo.findById(id);
  }

  async getRoleByName(name: string): Promise<OrgRole | null> {
    return this.repo.findByName(name);
  }
}
