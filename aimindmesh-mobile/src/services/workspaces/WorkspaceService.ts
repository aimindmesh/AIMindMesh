import { getKnowledgeDatabase } from '../database/knowledgeDatabase';
import { Workspace, CreateWorkspaceInput, DEFAULT_WORKSPACE_SETTINGS, WorkspaceSettings } from '../../types/workspace';
import { logger } from '../logger';

// Event bus mock - in real app should import from a centralized event bus
// For now we'll just log events or define a simple emitter if needed
const emitEvent = (name: string, data?: any) => {
    logger.log('info', `[Event] ${name}`, data);
};

// Context Mode for RAG
export type ContextMode = 'GLOBAL' | 'WORKSPACE' | 'NONE';

/** GLOBAL/NONE live here (WORKSPACE is the is_active row): "No workspace" survives restarts */
const CONTEXT_MODE_KEY = 'workspace-context-mode';

function readStoredMode(): ContextMode | null {
    try {
        const mode = localStorage.getItem(CONTEXT_MODE_KEY);
        return mode === 'GLOBAL' || mode === 'NONE' || mode === 'WORKSPACE' ? mode : null;
    } catch {
        return null;
    }
}

function storeMode(mode: ContextMode): void {
    try {
        localStorage.setItem(CONTEXT_MODE_KEY, mode);
    } catch {
        // Not persisted: the mode falls back to GLOBAL at the next start
    }
}

export class WorkspaceService {
    private activeWorkspace: Workspace | null = null;
    private contextMode: ContextMode = 'GLOBAL'; // Default to Global
    private initializePromise: Promise<void> | null = null;

    constructor() {
        // Do NOT call loadActiveWorkspace() here!
        // Database may not be ready at module import time.
        // Use ensureInitialized() for lazy initialization.
    }

    /**
     * Lazy initialization - call this before using the service
     */
    async ensureInitialized(): Promise<void> {
        if (this.initializePromise) {
            return this.initializePromise;
        }
        this.initializePromise = this.loadActiveWorkspace().then(loaded => {
            // DB not ready yet: the next call tries again instead of keeping the fallback forever
            if (!loaded) this.initializePromise = null;
        });
        return this.initializePromise;
    }

    async loadActiveWorkspace(): Promise<boolean> {
        try {
            const db = await getKnowledgeDatabase();
            const result = await db.query('SELECT * FROM workspaces WHERE is_active = 1 LIMIT 1');
            if (result.values && result.values.length > 0) {
                this.activeWorkspace = this.parseWorkspace(result.values[0]);
                this.contextMode = 'WORKSPACE';
            } else {
                // No active workspace: the saved choice between "Global" and "No workspace"
                this.activeWorkspace = null;
                this.contextMode = readStoredMode() === 'NONE' ? 'NONE' : 'GLOBAL';
            }
            return true;
        } catch (e) {
            logger.log('warn', '[Workspace] Failed to load active workspace', e);
            this.contextMode = readStoredMode() === 'NONE' ? 'NONE' : 'GLOBAL';
            return false;
        }
    }

    // CRUD Operations
    async createWorkspace(data: CreateWorkspaceInput): Promise<Workspace> {
        const db = await getKnowledgeDatabase();

        // Default values
        const settings = { ...DEFAULT_WORKSPACE_SETTINGS, ...(data.settings || {}) };
        const color = data.color || '#3B82F6';
        const icon = data.icon || '📁';

        const res = await db.run(`
      INSERT INTO workspaces (name, description, color, icon, created_at, settings, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `, [data.name, data.description || '', color, icon, Date.now(), JSON.stringify(settings)]);

        const id = res.changes?.lastId;
        if (!id) throw new Error('Failed to create workspace');

        emitEvent('workspace:created', { id });
        return (await this.getWorkspaceById(id))!;
    }

    async listWorkspaces(): Promise<Workspace[]> {
        const db = await getKnowledgeDatabase();
        // Complex query with counts
        const result = await db.query(`
      SELECT 
        w.*,
        (SELECT COUNT(*) FROM workspace_documents wd WHERE wd.workspace_id = w.id) as document_count,
        (SELECT COUNT(*) FROM workspace_threads wt WHERE wt.workspace_id = w.id) as thread_count
      FROM workspaces w
      ORDER BY w.last_used DESC NULLS LAST, w.created_at DESC
    `);

        return (result.values || []).map(row => this.parseWorkspace(row));
    }

    async getWorkspaceById(id: number): Promise<Workspace | null> {
        const db = await getKnowledgeDatabase();
        const result = await db.query('SELECT * FROM workspaces WHERE id = ?', [id]);
        if (result.values && result.values.length > 0) {
            return this.parseWorkspace(result.values[0]);
        }
        return null;
    }

    async findByName(name: string): Promise<Workspace | null> {
        const db = await getKnowledgeDatabase();
        const result = await db.query('SELECT * FROM workspaces WHERE name LIKE ?', [name]);
        if (result.values && result.values.length > 0) {
            return this.parseWorkspace(result.values[0]);
        }
        return null;
    }

    async switchWorkspace(workspaceId: number): Promise<void> {
        const db = await getKnowledgeDatabase();

        // Deactivate current
        await db.execute('UPDATE workspaces SET is_active = 0');

        // Activate new
        await db.run(`
      UPDATE workspaces 
      SET is_active = 1, last_used = ?
      WHERE id = ?
    `, [Date.now(), workspaceId]);

        this.activeWorkspace = await this.getWorkspaceById(workspaceId);
        this.contextMode = 'WORKSPACE';
        storeMode('WORKSPACE');

        emitEvent('workspace:switched', { workspace: this.activeWorkspace, mode: this.contextMode });
    }

    /**
     * Set Global Context (Search ALL documents)
     */
    async setGlobalContext(): Promise<void> {
        const db = await getKnowledgeDatabase();
        await db.execute('UPDATE workspaces SET is_active = 0');
        this.activeWorkspace = null;
        this.contextMode = 'GLOBAL';
        storeMode('GLOBAL');
        emitEvent('workspace:switched', { workspace: null, mode: 'GLOBAL' });
    }

    /**
     * Disable Context (No RAG)
     */
    async disableContext(): Promise<void> {
        // We deactivate workspace in DB so next load is consistent
        const db = await getKnowledgeDatabase();
        await db.execute('UPDATE workspaces SET is_active = 0');
        this.activeWorkspace = null;
        this.contextMode = 'NONE';
        storeMode('NONE');
        emitEvent('workspace:switched', { workspace: null, mode: 'NONE' });
    }

    /**
     * @deprecated Use setGlobalContext or disableContext instead
     */
    async deactivateWorkspace(): Promise<void> {
        return this.setGlobalContext();
    }

    getActiveWorkspace(): Workspace | null {
        return this.activeWorkspace;
    }

    getContextMode(): ContextMode {
        return this.contextMode;
    }

    // Document Management
    async addDocumentToWorkspace(workspaceId: number, documentId: number): Promise<void> {
        // Server-ingested documents have no local row (id -1): there is nothing to link
        if (!Number.isInteger(documentId) || documentId <= 0) {
            throw new Error('This document is indexed on the AIMindMesh server, not locally: it cannot be added to a local workspace');
        }
        const db = await getKnowledgeDatabase();
        await db.run(`
      INSERT OR IGNORE INTO workspace_documents (workspace_id, document_id, added_at)
      VALUES (?, ?, ?)
    `, [workspaceId, documentId, Date.now()]);
    }

    async removeDocumentFromWorkspace(workspaceId: number, documentId: number): Promise<void> {
        const db = await getKnowledgeDatabase();
        await db.run(`
      DELETE FROM workspace_documents 
      WHERE workspace_id = ? AND document_id = ?
    `, [workspaceId, documentId]);
    }

    async getWorkspaceDocuments(workspaceId: number): Promise<any[]> {
        const db = await getKnowledgeDatabase();
        const result = await db.query(`
      SELECT d.*, wd.added_at as added_to_workspace_at
      FROM documents d
      JOIN workspace_documents wd ON d.id = wd.document_id
      WHERE wd.workspace_id = ?
      ORDER BY d.title ASC
    `, [workspaceId]);

        return (result.values || []).map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {}
        }));
    }

    // Settings
    async updateWorkspaceSettings(workspaceId: number, settings: WorkspaceSettings): Promise<void> {
        const db = await getKnowledgeDatabase();
        await db.run(`
      UPDATE workspaces SET settings = ? WHERE id = ?
    `, [JSON.stringify(settings), workspaceId]);

        if (this.activeWorkspace?.id === workspaceId) {
            this.activeWorkspace.settings = settings;
        }
    }

    private parseWorkspace(row: any): Workspace {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            color: row.color,
            icon: row.icon,
            is_active: !!row.is_active,
            created_at: row.created_at,
            last_used: row.last_used,
            settings: row.settings ? JSON.parse(row.settings) : DEFAULT_WORKSPACE_SETTINGS,
            document_count: row.document_count,
            thread_count: row.thread_count
        };
    }
}

export const workspaceService = new WorkspaceService();
