import { ToolDefinition } from './types';
import { workspaceService } from '../workspaces/WorkspaceService';
import { DocumentIngestionService } from '../documents/DocumentIngestionService';
import { Type } from '@google/genai';

const ingestionService = new DocumentIngestionService();

export const workspaceTools: ToolDefinition[] = [
    {
        name: 'create_workspace',
        description: 'Create a new workspace for organizing documents.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'Name of the workspace' },
                description: { type: Type.STRING, description: 'Optional description' },
                icon: { type: Type.STRING, description: 'Emoji icon (default: 📁)' }
            },
            required: ['name']
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async (params: any) => {
            try {
                const ws = await workspaceService.createWorkspace({
                    name: params.name,
                    description: params.description,
                    icon: params.icon
                });
                return `Created workspace "${ws.name}" (ID: ${ws.id})`;
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    },

    {
        name: 'switch_workspace',
        description: 'Switch to a different workspace to change the document search context.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                workspace_name: { type: Type.STRING, description: 'Name of the workspace to switch to' }
            },
            required: ['workspace_name']
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async (params: any) => {
            const workspaces = await workspaceService.listWorkspaces();
            const target = workspaces.find(w =>
                w.name.toLowerCase().includes(params.workspace_name.toLowerCase())
            );

            if (!target) {
                return `Workspace "${params.workspace_name}" not found. Available: ${workspaces.map(w => w.name).join(', ')}`;
            }

            await workspaceService.switchWorkspace(target.id);
            return `Switched to workspace "${target.name}" (${target.document_count} documents)`;
        }
    },

    {
        name: 'list_workspaces',
        description: 'List all available workspaces.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: []
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async () => {
            const workspaces = await workspaceService.listWorkspaces();
            if (workspaces.length === 0) return 'No workspaces found.';

            return workspaces.map(w =>
                `${w.icon} ${w.name} (${w.document_count} docs)${w.is_active ? ' [ACTIVE]' : ''}`
            ).join('\n');
        }
    },

    {
        name: 'add_document_to_workspace',
        description: 'Add a document (upload/ingest) directly to a workspace.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                document_path: { type: Type.STRING, description: 'Path to document file' },
                workspace_name: { type: Type.STRING, description: 'Optional workspace name. Defaults to active.' }
            },
            required: ['document_path']
        },
        requiresConfirmation: false,
        category: 'files',
        handler: async (params: any) => {
            try {
                // 1. Ingest
                const doc = await ingestionService.ingestDocument(params.document_path);
                if (doc.status === 'failed') throw new Error(doc.error);

                // 2. Find Workspace
                let workspaceId: number;
                if (params.workspace_name) {
                    const ws = await workspaceService.findByName(params.workspace_name);
                    if (!ws) throw new Error(`Workspace ${params.workspace_name} not found`);
                    workspaceId = ws.id;
                } else {
                    const active = workspaceService.getActiveWorkspace();
                    if (!active) throw new Error('No active workspace. Please specify workspace_name.');
                    workspaceId = active.id;
                }

                // 3. Link
                await workspaceService.addDocumentToWorkspace(workspaceId, doc.id);

                return `Added document to workspace (ID: ${workspaceId}). Doc ID: ${doc.id}, Chunks: ${doc.chunks}`;
            } catch (e: any) {
                return `Error: ${e.message}`;
            }
        }
    }
];
