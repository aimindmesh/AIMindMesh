import { randomUUID } from 'crypto';
import db from '../../db/sqlite';
import { Directive, DirectiveGoalType } from './types';

export interface DirectiveRepository {
  insert(directive: Directive): Promise<void>;
  update(id: string, patch: Partial<Directive>): Promise<void>;
  markCancelled(id: string): Promise<void>;
  findActive(): Promise<Directive[]>;
  findById(id: string): Promise<Directive | null>;
}

export class SQLiteDirectiveRepository implements DirectiveRepository {
  private mapRow(row: any): Directive {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      goalType: row.goal_type as DirectiveGoalType,
      constraints: JSON.parse(row.constraints || '{}'),
      priority: row.priority,
      status: row.status as any,
      createdBy: row.created_by,
      supersedesId: row.supersedes_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async insert(directive: Directive): Promise<void> {
    db.prepare(`
      INSERT INTO organization_directives (
        id, title, description, goal_type, constraints, priority, status, created_by, supersedes_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      directive.id,
      directive.title,
      directive.description,
      directive.goalType,
      JSON.stringify(directive.constraints),
      directive.priority,
      directive.status,
      directive.createdBy,
      directive.supersedesId || null,
      directive.createdAt,
      directive.updatedAt
    );
  }

  async update(id: string, patch: Partial<Directive>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      goalType: 'goal_type',
      constraints: 'constraints',
      priority: 'priority',
      status: 'status',
      supersedesId: 'supersedes_id',
      updatedAt: 'updated_at'
    };

    for (const [key, val] of Object.entries(patch)) {
      const dbField = fieldMap[key];
      if (dbField) {
        fields.push(`${dbField} = ?`);
        if (typeof val === 'object' && val !== null) {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE organization_directives SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  async markCancelled(id: string): Promise<void> {
    db.prepare("UPDATE organization_directives SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async findActive(): Promise<Directive[]> {
    const rows = db.prepare("SELECT * FROM organization_directives WHERE status = 'active' ORDER BY priority DESC").all();
    return rows.map(r => this.mapRow(r));
  }

  async findById(id: string): Promise<Directive | null> {
    const row = db.prepare('SELECT * FROM organization_directives WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }
}

export class DirectiveService {
  constructor(private readonly repo: DirectiveRepository) {}

  async createDirective(input: Omit<Directive, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Directive> {
    const now = new Date().toISOString();
    const directive: Directive = {
      id: randomUUID(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    await this.repo.insert(directive);
    return directive;
  }

  async updateDirective(id: string, patch: Partial<Directive>): Promise<Directive> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error('Directive not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.repo.update(id, updated);
    return updated;
  }

  async cancelDirective(id: string): Promise<void> {
    await this.repo.markCancelled(id);
  }

  async getActiveDirectives(): Promise<Directive[]> {
    return this.repo.findActive();
  }

  static validateGoalType(goalType: string): goalType is DirectiveGoalType {
    return ['explore', 'build', 'improve', 'stop', 'pivot', 'research'].includes(goalType);
  }
}
