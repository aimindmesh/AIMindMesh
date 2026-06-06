import { randomUUID } from 'crypto';
import { OrgRole } from './types';
import { OrganizationRoleRepository } from './OrganizationRegistry';

export class RoleLifecycleService {
  constructor(private readonly repo: OrganizationRoleRepository) {}

  async createRole(input: Omit<OrgRole, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<OrgRole> {
    const existing = await this.repo.findByName(input.name);
    if (existing) throw new Error('Role name already exists');
    const now = new Date().toISOString();
    const role: OrgRole = {
      id: randomUUID(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    await this.repo.insert(role);
    return role;
  }

  async updateRole(id: string, patch: Partial<OrgRole>): Promise<OrgRole> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Role not found');
    if (patch.name && patch.name !== existing.name) {
      const clash = await this.repo.findByName(patch.name);
      if (clash) throw new Error('Role name already exists');
    }
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.repo.update(id, updated);
    return updated;
  }

  async archiveRole(id: string): Promise<void> {
    await this.repo.update(id, { status: 'archived', updatedAt: new Date().toISOString() } as Partial<OrgRole>);
  }

  async restoreRole(id: string): Promise<void> {
    await this.repo.update(id, { status: 'active', updatedAt: new Date().toISOString() } as Partial<OrgRole>);
  }
}
